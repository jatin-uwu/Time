const { JWT } = require('google-auth-library');

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun',
                'Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// ── Get access token impersonating the user email ─────────────────────────
async function getAccessToken(userEmail) {
    const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '')
        .replace(/\\n/g, '\n');

    if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !privateKey) {
        throw new Error('Google service account credentials not configured.');
    }

    const client = new JWT({
        email:   process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key:     privateKey,
        scopes:  SCOPES,
        subject: userEmail   // impersonate logged-in user
    });

    const token = await client.getAccessToken();
    return token.token;
}

// ── Fetch upcoming Google Meet events for a user ──────────────────────────
async function fetchUpcomingMeetings(userEmail) {
    if (!userEmail) return [];

    const accessToken = await getAccessToken(userEmail);

    const now     = new Date().toISOString();
    const in7days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const url = 'https://www.googleapis.com/calendar/v3/calendars/primary/events?' +
        new URLSearchParams({
            timeMin:       now,
            timeMax:       in7days,
            singleEvents:  'true',
            orderBy:       'startTime',
            maxResults:    '15'
        });

    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Google Calendar API error: ${errText}`);
    }

    const data  = await res.json();
    const items = data.items || [];

    // Filter only Google Meet events
    const meetEvents = items.filter(ev =>
        ev.hangoutLink ||
        (ev.conferenceData?.entryPoints || [])
            .some(ep => ep.entryPointType === 'video')
    );

    return meetEvents.map(ev => {
        const start = new Date(ev.start?.dateTime || ev.start?.date);
        const end   = ev.end?.dateTime ? new Date(ev.end.dateTime) : null;

        const timeStr = ev.start?.dateTime
            ? start.toLocaleTimeString('en-IN', {
                hour:   '2-digit',
                minute: '2-digit',
                hour12: true
              })
            : 'All Day';

        const endStr = end
            ? end.toLocaleTimeString('en-IN', {
                hour:   '2-digit',
                minute: '2-digit',
                hour12: true
              })
            : '';

        // Get meet link
        const meetLink =
            ev.hangoutLink ||
            (ev.conferenceData?.entryPoints || [])
                .find(ep => ep.entryPointType === 'video')?.uri ||
            null;

        // Attendees excluding self
        const attendees = (ev.attendees || [])
            .filter(a => a.email !== userEmail)
            .map(a => a.displayName || a.email);

        return {
            title:     ev.summary    || 'Untitled Meeting',
            dateLabel: `${DAYS[start.getDay()]}, ${start.getDate()} ${MONTHS[start.getMonth()]}`,
            timeLabel: endStr ? `${timeStr} – ${endStr}` : timeStr,
            meetLink:  meetLink,
            attendees: attendees.length,
            organizer: ev.organizer?.displayName || ev.organizer?.email || '',
            isToday:   start.toDateString() === new Date().toDateString(),
            status:    ev.status || 'confirmed'
        };
    });
}

module.exports = { fetchUpcomingMeetings };