// ─────────────────────────────────────────────────────────────────────────────
// FILE: srv/reminder-cron.js
// FIX: Pass createNotification into sendDailyReminders so consecutive-miss
//      alerts also create in-app dashboard notifications.
//
// USAGE in your main handler:
//   const { startReminderCron } = require('./reminder-cron');
//   cds.on('served', () => startReminderCron(getMailer, createNotification));
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
const cds = require('@sap/cds');
const { sendDailyReminders } = require('./timesheet-handler');

const MEETING     = 'ccentrik.employee.timesheet.schema.timesheet.Meeting';
const MTG_PART    = 'ccentrik.employee.timesheet.schema.timesheet.MeetingParticipant';
const MILESTONE   = 'ccentrik.employee.timesheet.schema.timesheet.Milestone';
const PROJECT     = 'ccentrik.employee.timesheet.schema.timesheet.Project';
const PROJ_RES    = 'ccentrik.employee.timesheet.schema.timesheet.ProjectResource';

// Milestones in these states need no health alerts.
const MS_TERMINAL    = ['Completed', 'Completed Early', 'Cancelled'];
const DEADLINE_DAYS  = 3;   // "approaching deadline" window (configurable)

let _cronStarted = false;

// ── Meeting reminder windows ───────────────────────────────────────────────────
// For each scheduled (non-cancelled) meeting, fire a notification if the meeting
// starts within the window and no reminder was sent yet for that window.
// We tag the checked window into the meeting title to avoid re-sending —
// because adding a "remindersSent" column would require a schema migration,
// we track via a simple in-process Set that resets on server restart
// (acceptable: reminders re-fire at most once per restart per window).
const _remindersSent = new Set(); // key: `${meetingId}-${windowKey}`

async function sendMeetingReminders(createNotification) {
    if (!cds.db) return; // DB not ready yet
    const { SELECT } = cds.ql;
    const now = Date.now();
    // Check meetings starting in next 24h and not yet cancelled.
    const horizon = new Date(now + 25 * 60 * 60 * 1000).toISOString();
    let meetings;
    try {
        meetings = await SELECT.from(MEETING)
            .columns('meetingId', 'title', 'startDateTime', 'status', 'organizer_employeeId')
            .where({ status: 'Scheduled' })
            .where({ startDateTime: { '<=': horizon } });
    } catch (e) {
        cds.log('mtg-cron').warn('Could not query meetings for reminders:', e.message);
        return;
    }
    if (!meetings || !meetings.length) return;

    const WINDOWS = [
        { key: '5m',  ms: 5  * 60 * 1000, label: '5 minutes' },
        { key: '15m', ms: 15 * 60 * 1000, label: '15 minutes' },
        { key: '1h',  ms: 60 * 60 * 1000, label: '1 hour' },
        { key: '24h', ms: 24 * 60 * 60 * 1000, label: '24 hours' }
    ];

    for (const m of meetings) {
        const startsIn = new Date(m.startDateTime).getTime() - now;
        if (startsIn < 0) continue; // already started
        for (const w of WINDOWS) {
            const key = `${m.meetingId}-${w.key}`;
            if (_remindersSent.has(key)) continue;
            // Fire if meeting starts within [window, window + 5min] (5-min check cadence).
            if (startsIn <= w.ms + 5 * 60 * 1000 && startsIn > w.ms - 5 * 60 * 1000) {
                _remindersSent.add(key);
                let parts;
                try {
                    parts = await SELECT.from(MTG_PART).columns('employee_employeeId').where({ meeting_meetingId: m.meetingId });
                } catch (e) { parts = []; }
                // Notify organizer + all participants.
                const empIds = new Set([m.organizer_employeeId, ...(parts || []).map(p => p.employee_employeeId)].filter(Boolean));
                for (const empId of empIds) {
                    await createNotification(empId, 'MEETING_REMINDER',
                        `Meeting in ${w.label}`,
                        `"${m.title}" starts in ${w.label}.`,
                        m.meetingId).catch(() => {});
                }
                cds.log('mtg-cron').info(`Reminder (${w.key}) sent for meeting ${m.meetingId} to ${empIds.size} recipient(s).`);
            }
        }
    }
}

// ── Proactive milestone health alerts (Phase 14) ───────────────────────────────
// Once a day, scan milestones on active projects and notify the milestone owner +
// project POC about: (1) overdue, (2) deadline approaching within DEADLINE_DAYS,
// (3) committed resource cost exceeding the milestone's planned budget.
// Deduped per (milestone, type, day) so each alert fires at most once per day.
const _msAlertsSent = new Set();   // key: `${milestoneId}-${type}-${YYYY-MM-DD}`

async function sendMilestoneAlerts(createNotification) {
    if (!cds.db) return;
    const { SELECT } = cds.ql;
    const today = new Date().toISOString().slice(0, 10);
    let milestones, projects, resources;
    try {
        milestones = await SELECT.from(MILESTONE)
            .columns('milestoneId', 'name', 'plannedEndDate', 'status', 'plannedBudget', 'owner_employeeId', 'project_projectId');
        projects = await SELECT.from(PROJECT).columns('projectId', 'projectName', 'poc_employeeId', 'status');
        resources = await SELECT.from(PROJ_RES).columns('milestone_milestoneId', 'totalAllocationCost');
    } catch (e) {
        cds.log('ms-cron').warn('Could not query milestones for alerts:', e.message);
        return;
    }
    if (!milestones || !milestones.length) return;

    const projById = {}; (projects || []).forEach(p => { projById[p.projectId] = p; });
    // Committed cost per milestone (sum of frozen allocation cost snapshots).
    const costByMs = {}; (resources || []).forEach(r => {
        if (!r.milestone_milestoneId) return;
        costByMs[r.milestone_milestoneId] = (costByMs[r.milestone_milestoneId] || 0) + (Number(r.totalAllocationCost) || 0);
    });

    const dayMs = 86400000;
    const fire = async (mid, type, recipients, title, message, projectId) => {
        const key = `${mid}-${type}-${today}`;
        if (_msAlertsSent.has(key)) return;
        _msAlertsSent.add(key);
        for (const empId of recipients) {
            await createNotification(empId, type, title, message, projectId).catch(() => {});
        }
    };

    for (const m of milestones) {
        if (MS_TERMINAL.includes(m.status)) continue;
        const proj = projById[m.project_projectId];
        if (!proj || proj.status === 'Completed' || proj.status === 'Cancelled') continue;
        const recipients = [...new Set([m.owner_employeeId, proj.poc_employeeId].filter(Boolean))];
        if (!recipients.length) continue;
        const pName = proj.projectName || m.project_projectId;
        const pEnd = m.plannedEndDate ? String(m.plannedEndDate).slice(0, 10) : null;

        if (pEnd) {
            if (today > pEnd) {
                const lateDays = Math.round((Date.parse(today) - Date.parse(pEnd)) / dayMs);
                await fire(m.milestoneId, 'MILESTONE_DELAYED', recipients, 'Milestone Overdue',
                    `Milestone "${m.name}" in ${pName} is ${lateDays} day(s) overdue (due ${pEnd}).`, m.project_projectId);
            } else {
                const daysLeft = Math.round((Date.parse(pEnd) - Date.parse(today)) / dayMs);
                if (daysLeft >= 0 && daysLeft <= DEADLINE_DAYS) {
                    await fire(m.milestoneId, 'MILESTONE_DEADLINE', recipients, 'Milestone Deadline Approaching',
                        `Milestone "${m.name}" in ${pName} is due in ${daysLeft} day(s) (${pEnd}).`, m.project_projectId);
                }
            }
        }
        const planned = Number(m.plannedBudget) || 0;
        const committed = costByMs[m.milestoneId] || 0;
        if (planned > 0 && committed > planned) {
            await fire(m.milestoneId, 'MILESTONE_BUDGET', recipients, 'Milestone Budget Exceeded',
                `Committed resource cost (₹${Math.round(committed).toLocaleString('en-IN')}) for milestone "${m.name}" in ${pName} exceeds its planned budget (₹${planned.toLocaleString('en-IN')}).`, m.project_projectId);
        }
    }
}

function startReminderCron(getMailer, createNotification) {
    if (_cronStarted) return;

    let nodeCron;
    try {
        nodeCron = require('node-cron');
    } catch (e) {
        cds.log('reminder').warn(
            'node-cron not installed. Reminders disabled. Run: npm install node-cron'
        );
        return;
    }

    // 5:00 PM every weekday Mon–Sat (Sunday excluded — company holiday)
    nodeCron.schedule('0 17 * * 1-6', async () => {
        cds.log('reminder').info('5 PM cron triggered — running daily reminder...');
        try {
            await sendDailyReminders(getMailer, createNotification);
        } catch (e) {
            cds.log('reminder').error('5 PM reminder cron failed:', e.message || e);
        }
    }, { timezone: process.env.TZ || 'Asia/Kolkata' });

    // Every 5 minutes — meeting reminders (24h / 1h / 15m / 5m before start).
    nodeCron.schedule('*/5 * * * *', async () => {
        try {
            await sendMeetingReminders(createNotification);
        } catch (e) {
            cds.log('mtg-cron').error('Meeting reminder cron failed:', e.message || e);
        }
    }, { timezone: process.env.TZ || 'Asia/Kolkata' });

    // Daily 8 AM Mon–Sat — proactive milestone health alerts.
    nodeCron.schedule('0 8 * * 1-6', async () => {
        try {
            await sendMilestoneAlerts(createNotification);
        } catch (e) {
            cds.log('ms-cron').error('Milestone alert cron failed:', e.message || e);
        }
    }, { timezone: process.env.TZ || 'Asia/Kolkata' });

    _cronStarted = true;
    cds.log('reminder').info(`Reminder cron scheduled (timezone: ${process.env.TZ || 'Asia/Kolkata'})`);
}

module.exports = { startReminderCron, sendMilestoneAlerts };