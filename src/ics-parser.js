function parseIcs(text) {
  const lines = String(text || '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let event = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') event = {};
    else if (line === 'END:VEVENT') {
      if (event?.date && event.title) events.push(...expandRecurringEvent(event));
      event = null;
    } else if (event) {
      let quoted = false;
      let separator = -1;
      for (let index = 0; index < line.length; index++) {
        if (line[index] === '"') quoted = !quoted;
        if (line[index] === ':' && !quoted) { separator = index; break; }
      }
      if (separator < 0) continue;
      const key = line.slice(0, separator).split(';')[0];
      const value = line.slice(separator + 1);
      if (key === 'DTSTART') {
        const match = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z)?/);
        if (match) {
          event.date = `${match[1]}-${match[2]}-${match[3]}`;
          if (match[4]) {
            event.time = `${match[4]}:${match[5]}`;
            const parts = match.slice(1, 7).map(Number);
            const start = match[7]
              ? new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5] || 0))
              : new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5] || 0);
            event.startAt = start.toISOString();
          }
        }
      } else if (key === 'SUMMARY') {
        event.title = value.replace(/\\([,;\\])/g, '$1').replace(/\\n/gi, ' ');
      } else if (key === 'DTEND') {
        const match = value.match(/^\d{8}T(\d{2})(\d{2})/);
        if (match) event.endTime = `${match[1]}:${match[2]}`;
      } else if (key === 'LOCATION') {
        event.location = value.replace(/\\([,;\\])/g, '$1').replace(/\\n/gi, '\n');
      } else if (key === 'DESCRIPTION') {
        event.description = value.replace(/\\([,;\\])/g, '$1').replace(/\\n/gi, '\n').trim();
      } else if (key === 'UID') {
        event.id = value;
      } else if (key === 'RRULE') {
        event.rrule = Object.fromEntries(value.split(';').map(part => part.split('=')));
      }
    }
  }
  return events;
}

function expandRecurringEvent(event) {
  const { FREQ, UNTIL, BYDAY, INTERVAL = '1', WKST = 'MO' } = event.rrule || {};
  if (FREQ !== 'WEEKLY' || !UNTIL || !BYDAY) return [event];

  const weekdays = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  const wantedDays = new Set(BYDAY.split(',').map(day => weekdays[day]));
  const start = new Date(`${event.date}T12:00:00`);
  const untilMatch = UNTIL.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!untilMatch || !Number(INTERVAL)) return [event];
  const until = new Date(+untilMatch[1], +untilMatch[2] - 1, +untilMatch[3], 12);
  const weekStart = weekdays[WKST] ?? 1;
  const seriesWeek = new Date(start);
  seriesWeek.setDate(seriesWeek.getDate() - ((seriesWeek.getDay() - weekStart + 7) % 7));
  const occurrences = [];

  for (const date = new Date(start); date <= until && occurrences.length < 2000; date.setDate(date.getDate() + 1)) {
    const currentWeek = new Date(date);
    currentWeek.setDate(currentWeek.getDate() - ((currentWeek.getDay() - weekStart + 7) % 7));
    const weeksSinceStart = Math.round((currentWeek - seriesWeek) / 604800000);
    if (!wantedDays.has(date.getDay()) || weeksSinceStart % Number(INTERVAL)) continue;
    const isoDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const occurrence = { ...event, id: `${event.id || event.title}:${isoDate}`, date: isoDate };
    delete occurrence.rrule;
    if (event.time) occurrence.startAt = new Date(`${isoDate}T${event.time}:00`).toISOString();
    occurrences.push(occurrence);
  }
  return occurrences;
}

module.exports = { parseIcs };

if (require.main === module) {
  const assert = require('assert');
  assert.deepStrictEqual(parseIcs('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:one\r\nDTSTART:20260928T133000\r\nDTEND:20260928T140000\r\nSUMMARY:Plan\\, review\r\nLOCATION:Room 1\r\nDESCRIPTION:Line 1\\nLine 2\r\nEND:VEVENT\r\nEND:VCALENDAR'), [
    { id: 'one', date: '2026-09-28', time: '13:30', startAt: new Date(2026, 8, 28, 13, 30).toISOString(), endTime: '14:00', title: 'Plan, review', location: 'Room 1', description: 'Line 1\nLine 2' },
  ]);
  assert.equal(parseIcs('BEGIN:VEVENT\r\nDTSTART;TZID="(UTC+03:30) Tehran":20260928T090000\r\nSUMMARY:Standup\r\nEND:VEVENT')[0].time, '09:00');
  assert.deepStrictEqual(
    parseIcs('BEGIN:VEVENT\r\nUID:daily\r\nRRULE:FREQ=WEEKLY;UNTIL=20261003T073000Z;INTERVAL=1;BYDAY=MO,WE,SA;WKST=SA\r\nSUMMARY:Daily\r\nDTSTART:20260928T110000\r\nEND:VEVENT').map(event => event.date),
    ['2026-09-28', '2026-09-30', '2026-10-03'],
  );
}
