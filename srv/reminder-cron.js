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

let _cronStarted = false;

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
            // FIX: pass createNotification so consecutive-miss fires dashboard alert
            await sendDailyReminders(getMailer, createNotification);
        } catch (e) {
            cds.log('reminder').error('5 PM reminder cron failed:', e.message || e);
        }
    }, {
        timezone: process.env.TZ || 'Asia/Kolkata'
    });

    _cronStarted = true;
    cds.log('reminder').info(
        `Reminder cron scheduled (timezone: ${process.env.TZ || 'Asia/Kolkata'})`
    );
}

module.exports = { startReminderCron };