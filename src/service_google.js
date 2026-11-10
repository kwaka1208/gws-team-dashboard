/**
 * service_google.js — Google カレンダーと Gmail（開いている本人の権限で読む）
 */

/**
 * 期間内の予定。日付の範囲はブラウザ側（その人の地域の時刻）で決めて渡す。
 * @param {{ timeMin: string, timeMax: string, allCalendars: boolean }} params
 */
function calendarEvents_(params) {
  const timeMin = new Date(params && params.timeMin);
  const timeMax = new Date(params && params.timeMax);
  if (isNaN(timeMin) || isNaN(timeMax) || timeMax <= timeMin || timeMax - timeMin > 31 * 86400000) {
    throw new UserError('カレンダーの期間の指定が正しくありません');
  }
  let calendars = [{ id: 'primary', color: '', name: '' }];
  if (params.allCalendars) {
    const list = Calendar.CalendarList.list({ minAccessRole: 'reader', maxResults: 50 });
    const selected = (list.items || []).filter(function (c) { return c.selected || c.primary; });
    if (selected.length) {
      calendars = selected.map(function (c) {
        return { id: c.id, color: c.backgroundColor || '', name: c.summaryOverride || c.summary || '' };
      });
    }
  }
  const events = [];
  calendars.forEach(function (cal) {
    let data;
    try {
      data = Calendar.Events.list(cal.id, {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 50,
      });
    } catch (err) {
      console.warn('calendar skipped: ' + cal.id + ' ' + err);
      return;
    }
    (data.items || []).forEach(function (ev) {
      if (ev.status === 'cancelled') return;
      events.push({
        id: cal.id + ':' + ev.id,
        title: ev.summary || '',
        start: ev.start || {},
        end: ev.end || {},
        link: ev.htmlLink || '',
        location: ev.location || '',
        meet: ev.hangoutLink || '',
        color: cal.color,
        calendar: cal.name,
      });
    });
  });
  return events;
}

const MAIL_LABEL_IDS = ['INBOX', 'IMPORTANT', 'STARRED', 'UNREAD', 'CATEGORY_PERSONAL', 'CATEGORY_UPDATES', 'CATEGORY_SOCIAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_FORUMS'];

function gmailUnread_(labelId) {
  const id = String(labelId || 'INBOX');
  if (MAIL_LABEL_IDS.indexOf(id) < 0 && !/^Label_\w+$/.test(id)) throw new UserError('ラベルの指定が正しくありません');
  const label = Gmail.Users.Labels.get('me', id);
  return {
    unreadMessages: Number(label.messagesUnread || 0),
    unreadThreads: Number(label.threadsUnread || 0),
  };
}
