// Erkundung: Programm eines Wettkampfs („Events to be staged“) über getCompetitionOrganiserInfo. Ausgabe nur im Protokoll.
import { discoverApiConfig, sleep } from "../importer/wa";

const api = await discoverApiConfig();
async function gql(query: string, variables: Record<string, unknown> = {}) {
  await sleep(700);
  const res = await fetch(api.url, { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": api.key },
    body: JSON.stringify({ query, variables }) });
  return res.json() as Promise<any>;
}
const REF = "name kind ofType { name kind ofType { name kind ofType { name kind } } }";
const base = (t: any): any => (t?.ofType ? base(t.ofType) : t);
async function sel(name: string, depth: number): Promise<string> {
  const t = (await gql(`query($n:String!){__type(name:$n){fields{name args{name type{${REF}}} type{${REF}}}}}`, { n: name })).data?.__type;
  if (!t?.fields) return "";
  const parts: string[] = [];
  for (const f of t.fields) {
    if (f.args?.some((a: any) => a.type.kind === "NON_NULL")) continue;
    const b = base(f.type);
    if (b.kind === "SCALAR" || b.kind === "ENUM") parts.push(f.name);
    else if (depth > 0) { const s = await sel(b.name, depth - 1); if (s) parts.push(`${f.name} { ${s} }`); }
  }
  return parts.join(" ");
}
const schema = (await gql(`{__schema{queryType{fields{name args{name type{${REF}}} type{${REF}}}}}}`)).data.__schema.queryType.fields;
for (const n of ["getCompetitionOrganiserInfo", "getCalendarEvents"]) {
  const f = schema.find((x: any) => x.name === n);
  console.log(n, JSON.stringify(f.args.map((a: any) => a.name)), "->", base(f.type).name);
}
const f = schema.find((x: any) => x.name === "getCompetitionOrganiserInfo");
const s = await sel(base(f.type).name, 4);
console.log("AUSWAHL", s);
// Beispiele: kommende Wettkämpfe aus dem Kalender
const cal = await gql(`query{getCalendarEvents(startDate:"2026-11-16",endDate:"2027-06-30",regionType:"country",regionId:13188422,limit:8,offset:0){results{id name rankingCategory disciplines startDate}}}`);
const ids = [7248004, ...(cal.data?.getCalendarEvents?.results ?? []).map((r: any) => r.id)];
console.log("KALENDER", JSON.stringify(cal.data?.getCalendarEvents?.results ?? cal.errors).slice(0, 1500));
for (const id of ids.slice(0, 6)) {
  const r = await gql(`query($id:Int!){getCompetitionOrganiserInfo(competitionId:$id){${s}}}`, { id: Number(id) });
  console.log("ORGANISER", id, JSON.stringify(r).slice(0, 2500));
}
