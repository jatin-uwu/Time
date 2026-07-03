'use strict';

// Microsoft Teams / Graph API meeting service.
// When MS_CLIENT_ID is absent (local SQLite dev), all calls return mock data
// so the full UI is exercisable without real Azure credentials.

const MOCK_MODE = !process.env.MS_CLIENT_ID;
const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

let _msalApp = null;

function _fmtDate(d) {
    return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function _fmtTime(d) {
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

// ── Graph API access token (client-credentials flow) ──────────────────────────
async function getGraphToken() {
    if (MOCK_MODE) return 'MOCK_TOKEN';
    if (!_msalApp) {
        const { ConfidentialClientApplication } = require('@azure/msal-node');
        _msalApp = new ConfidentialClientApplication({
            auth: {
                clientId:     process.env.MS_CLIENT_ID,
                clientSecret: process.env.MS_CLIENT_SECRET,
                authority:    `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}`
            }
        });
    }
    const result = await _msalApp.acquireTokenByClientCredential({
        scopes: ['https://graph.microsoft.com/.default']
    });
    if (!result || !result.accessToken) throw new Error('Could not acquire MS Graph token.');
    return result.accessToken;
}

// ── Create a Teams meeting via Graph API ─────────────────────────────────────
// Returns { teamsMeetingId, teamsJoinUrl, teamsDialIn }
async function createMeeting({ title, agenda, startDateTime, endDateTime, organizerEmail, participants }) {
    if (MOCK_MODE) {
        const mockId = `mock-mtg-${Date.now()}`;
        return {
            teamsMeetingId: mockId,
            teamsJoinUrl:   `https://teams.microsoft.com/l/meetup-join/${mockId}/0?context=%7B%7D`,
            teamsDialIn:    null
        };
    }
    const axios  = require('axios');
    const token  = await getGraphToken();
    const body   = {
        subject: title,
        body:    { contentType: 'text', content: agenda || '' },
        start:   { dateTime: startDateTime, timeZone: 'Asia/Kolkata' },
        end:     { dateTime: endDateTime,   timeZone: 'Asia/Kolkata' },
        isOnlineMeeting:         true,
        onlineMeetingProvider:   'teamsForBusiness',
        attendees: (participants || []).map(p => ({
            emailAddress: { address: p.email, name: p.name || p.email },
            type: 'required'
        }))
    };
    const res = await axios.post(
        `https://graph.microsoft.com/v1.0/users/${organizerEmail}/onlineMeetings`,
        body,
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    return {
        teamsMeetingId: res.data.id,
        teamsJoinUrl:   res.data.joinWebUrl || (res.data.onlineMeeting && res.data.onlineMeeting.joinUrl) || '',
        teamsDialIn:    (res.data.audioConferencing && res.data.audioConferencing.dialinUrl) || null
    };
}

// ── Update an existing Teams meeting ─────────────────────────────────────────
async function updateMeeting({ teamsMeetingId, title, agenda, startDateTime, endDateTime, organizerEmail }) {
    if (MOCK_MODE) return { ok: true };
    const axios = require('axios');
    const token = await getGraphToken();
    await axios.patch(
        `https://graph.microsoft.com/v1.0/users/${organizerEmail}/onlineMeetings/${teamsMeetingId}`,
        {
            subject: title,
            body:    { contentType: 'text', content: agenda || '' },
            start:   { dateTime: startDateTime, timeZone: 'Asia/Kolkata' },
            end:     { dateTime: endDateTime,   timeZone: 'Asia/Kolkata' }
        },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    return { ok: true };
}

// ── Cancel (delete) a Teams meeting ──────────────────────────────────────────
async function cancelMeeting({ teamsMeetingId, organizerEmail }) {
    if (MOCK_MODE) return { ok: true };
    const axios = require('axios');
    const token = await getGraphToken();
    await axios.delete(
        `https://graph.microsoft.com/v1.0/users/${organizerEmail}/onlineMeetings/${teamsMeetingId}`,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    return { ok: true };
}

// ── Format DB meeting rows for dashboard / list display ───────────────────────
function formatMeetingForDisplay(m) {
    const start = new Date(m.startDateTime);
    const end   = m.endDateTime ? new Date(m.endDateTime) : null;
    const now   = new Date();
    // Human-friendly duration ("1 Hour 30 Minutes").
    let durationMins = 0, durationLabel = '';
    if (end && !isNaN(start) && !isNaN(end)) {
        durationMins = Math.max(0, Math.round((end - start) / 60000));
        const h = Math.floor(durationMins / 60), mm = durationMins % 60;
        durationLabel = [h ? `${h} Hour${h > 1 ? 's' : ''}` : '', mm ? `${mm} Minute${mm > 1 ? 's' : ''}` : ''].filter(Boolean).join(' ') || '0 Minutes';
    }
    return {
        meetingId:    m.meetingId,
        title:        m.title,
        meetingType:  m.meetingType || '',
        agenda:       m.agenda || '',
        dateLabel:    _fmtDate(start),
        timeLabel:    end ? `${_fmtTime(start)} – ${_fmtTime(end)}` : _fmtTime(start),
        durationMins, durationLabel,
        meetingMode:  m.meetingMode || 'Teams',
        location:     m.location || '',
        timeZone:     m.timeZone || '',
        teamsJoinUrl: m.teamsJoinUrl || null,
        teamsMeetingId: m.teamsMeetingId || null,
        manualLink:   m.manualLink === true,
        organizer:    m.organizerName || m.organizerEmail || '',
        organizerEmail: m.organizerEmail || '',
        status:       m.status || 'Scheduled',
        projectId:    m.project_projectId || '',
        projectName:  m.projectName || '',
        isToday:      start.toDateString() === now.toDateString(),
        startISO:     m.startDateTime,
        endISO:       m.endDateTime
    };
}

module.exports = { getGraphToken, createMeeting, updateMeeting, cancelMeeting, formatMeetingForDisplay, MOCK_MODE };
