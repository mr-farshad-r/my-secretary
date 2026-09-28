function parseIcs(text) {
  const lines = String(text || '').replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let event = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') event = {};
    else if (line === 'END:VEVENT') {
      if (event?.date && event.title) events.push(event);
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
      }
    }
  }
  return events;
}

module.exports = { parseIcs };

if (require.main === module) {
  const assert = require('assert');
  assert.deepStrictEqual(parseIcs('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:one\r\nDTSTART:20260928T133000\r\nDTEND:20260928T140000\r\nSUMMARY:Plan\\, review\r\nLOCATION:Room 1\r\nDESCRIPTION:Line 1\\nLine 2\r\nEND:VEVENT\r\nEND:VCALENDAR'), [
    { id: 'one', date: '2026-09-28', time: '13:30', startAt: new Date(2026, 8, 28, 13, 30).toISOString(), endTime: '14:00', title: 'Plan, review', location: 'Room 1', description: 'Line 1\nLine 2' },
  ]);
  assert.equal(parseIcs('BEGIN:VEVENT\r\nDTSTART;TZID="(UTC+03:30) Tehran":20260928T090000\r\nSUMMARY:Standup\r\nEND:VEVENT')[0].time, '09:00');
}
