import React, { useEffect } from "react";
import { Routes, Route } from "react-router";
import { useAppClient, ConnectionSettings, ConsentScreen, OpenInBrowser, ViewCard } from "@app-builder/core/react";
import { AppFrame, RiAppProvider, installStyles } from "./people/view/kit/index.js";
import { PeopleApp } from "./people/view/app.js";
import { peopleCss } from "./people/view/styles.js";
import { dateLabel, dayLabel, meetingLabel } from "./people/view/format.js";

// People's screens are the ones it had in Ri (src/people/view), on the kit's client.
if (typeof document !== "undefined") installStyles(peopleCss);

/** A card opens the whole app at one record: full screen, at its path (the kit's openFullscreen). */
function openInApp(client: ReturnType<typeof useAppClient>, path: string) {
  void client.openFullscreen(path).catch(() => {});
}

export function PeopleScreen() {
  const client = useAppClient();
  useEffect(() => { installStyles(peopleCss); }, []);
  return <>
    {/* In the browser, Settings. Inside a host, the way out: Open in browser, at the place the person is in. */}
    <nav className="people-top" aria-label="App">{client.embedded ? <OpenInBrowser /> : <a href="/settings">Settings</a>}</nav>
    <RiAppProvider><AppFrame><PeopleApp /></AppFrame></RiAppProvider>
  </>;
}

type Ref = { id: string; name: string };
type Summary = { id: string; name: string; company: Ref | null; role: string | null; lastExchangeAt: string | null; nextMeeting: { at: string; title: string } | null };
type FollowUp = { id: string; action: string; dueDate: string | null; person: Ref | null; direction: "i_owe" | "waiting_on" };

function useSelection() {
  const client = useAppClient();
  useEffect(() => () => client.select(null), [client.select]);
  return (record: Ref | null) => client.select(record ? { id: record.id, title: record.name } : null);
}

function FollowUpRows({ items, onPerson }: { items: FollowUp[]; onPerson(person: Ref): void }) {
  return <ul className="view-list">{items.map((item) => <li key={item.id} className="view-row">
    <button type="button" className="view-row-body" onClick={() => item.person && onPerson(item.person)}>
      <strong>{item.action}</strong>
      <span>{[item.direction === "i_owe" ? "You owe" : "Waiting on", item.person?.name, item.dueDate ? `due ${dateLabel(item.dueDate)}` : null].filter(Boolean).join(" · ")}</span>
    </button>
  </li>)}</ul>;
}

/** show_people: the people the assistant named or found. */
export function PeopleCard({ data }: { data: { title: string; people: Summary[]; more: boolean } }) {
  const client = useAppClient();
  const select = useSelection();
  return <div className="people-card"><ViewCard title={data.title} count={data.people.length ? `${data.people.length}${data.more ? "+" : ""}` : undefined} footer={data.more ? "More in People." : undefined}>
    {data.people.length ? <ul className="view-list">{data.people.map((person) => <li key={person.id} className="view-row">
      <button type="button" className="view-row-body" onClick={() => { select(person); openInApp(client, `/people/${person.id}`); }}>
        <strong>{person.name}</strong>
        <span>{[person.role, person.company?.name].filter(Boolean).join(", ") || "No company recorded"}</span>
        <span>{person.lastExchangeAt ? `Last exchange ${dayLabel(person.lastExchangeAt)}` : "No exchange yet"}{person.nextMeeting ? ` · Next: ${person.nextMeeting.title}, ${meetingLabel(person.nextMeeting.at)}` : ""}</span>
      </button>
    </li>)}</ul> : <p className="view-empty">Nobody matches.</p>}
  </ViewCard></div>;
}

/** show_person: one person's card. */
export function PersonCard({ data }: { data: { id: string; name: string; headline: string | null; company: Ref | null; role: string | null; location: string | null; howMet: string | null; lastExchangeAt: string | null; nextMeeting: { at: string; title: string } | null; followUps: FollowUp[] } }) {
  const client = useAppClient();
  const select = useSelection();
  useEffect(() => { select({ id: data.id, name: data.name }); }, [data.id]);
  const fields: [string, string | null][] = [
    ["Works at", [data.role, data.company?.name].filter(Boolean).join(", ") || null],
    ["Lives in", data.location], ["How you met", data.howMet],
    ["Last exchange", data.lastExchangeAt ? dayLabel(data.lastExchangeAt) : null],
    ["Next meeting", data.nextMeeting ? `${data.nextMeeting.title}, ${meetingLabel(data.nextMeeting.at)}` : null],
  ];
  return <div className="people-card"><ViewCard title={data.name}>
    {data.headline && <p className="view-card-foot">{data.headline}</p>}
    <dl>{fields.filter(([, value]) => value).map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}</dl>
    {data.followUps.length > 0 && <><h2>Follow-ups</h2><FollowUpRows items={data.followUps} onPerson={() => openInApp(client, `/people/${data.id}`)} /></>}
    {!client.view?.canFullscreen && <p className="view-card-foot">Open People to see their timeline and notes.</p>}
  </ViewCard></div>;
}

/** show_follow_ups: what the person owes and is waiting on. */
export function FollowUpsCard({ data }: { data: { title: string; items: FollowUp[] } }) {
  const client = useAppClient();
  const select = useSelection();
  return <div className="people-card"><ViewCard title={data.title} count={data.items.length ? String(data.items.length) : undefined}>
    {data.items.length ? <FollowUpRows items={data.items} onPerson={(person) => { select(person); openInApp(client, `/people/${person.id}`); }} /> : <p className="view-empty">Nothing open.</p>}
  </ViewCard></div>;
}

/** show_today: meetings, follow-ups, keep in touch and birthdays. */
export function TodayCard({ data }: { data: { meetings: { id: string; at: string; title: string; people: Ref[] }[]; followUps: FollowUp[]; keepInTouch: { id: string; name: string; lastExchangeAt: string | null }[]; birthdays: { id: string; name: string; inDays: number }[]; empty: boolean } }) {
  const client = useAppClient();
  const select = useSelection();
  const person = (ref: Ref) => { select(ref); openInApp(client, `/people/${ref.id}`); };
  if (data.empty) return <div className="people-card"><ViewCard title="Today"><p className="view-empty">Nothing needs your attention.</p></ViewCard></div>;
  return <div className="people-card"><ViewCard title="Today">
    {data.meetings.length > 0 && <><h2>Meetings</h2><ul className="view-list">{data.meetings.map((meeting) => <li key={meeting.id} className="view-row">
      <button type="button" className="view-row-body" onClick={() => meeting.people[0] && person(meeting.people[0])}><strong>{meeting.title}</strong><span>{[meetingLabel(meeting.at), meeting.people.map((item) => item.name).join(", ")].filter(Boolean).join(" · ")}</span></button>
    </li>)}</ul></>}
    {data.followUps.length > 0 && <><h2>Follow-ups</h2><FollowUpRows items={data.followUps} onPerson={person} /></>}
    {data.keepInTouch.length > 0 && <><h2>Keep in touch</h2><ul className="view-list">{data.keepInTouch.map((item) => <li key={item.id} className="view-row">
      <button type="button" className="view-row-body" onClick={() => person(item)}><strong>{item.name}</strong><span>{item.lastExchangeAt ? `Last exchange ${dayLabel(item.lastExchangeAt)}` : "No exchange yet"}</span></button>
    </li>)}</ul></>}
    {data.birthdays.length > 0 && <><h2>Birthdays</h2><ul className="view-list">{data.birthdays.map((item) => <li key={item.id} className="view-row">
      <button type="button" className="view-row-body" onClick={() => person(item)}><strong>{item.name}</strong><span>{item.inDays === 0 ? "Today" : item.inDays === 1 ? "Tomorrow" : `In ${item.inDays} days`}</span></button>
    </li>)}</ul></>}
  </ViewCard></div>;
}

/** Cards for the app's show_* tools. Anything else in an assistant draws the whole app. */
export const viewCards = { show_people: PeopleCard, show_person: PersonCard, show_follow_ups: FollowUpsCard, show_today: TodayCard };

export function AppScreens() {
  return <Routes><Route path="/settings" element={<ConnectionSettings />} /><Route path="/oauth/consent" element={<ConsentScreen />} /><Route path="*" element={<PeopleScreen />} /></Routes>;
}
