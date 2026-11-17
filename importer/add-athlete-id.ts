// WA-ID aus der Eingabe „Athlet hinzufügen“: Zahl oder Link zum WA-Profil („…/athletes/germany/tom-thurley-14682657“)
/** WA-ID aus Zahl oder Profil-Link. */
export function idFromQuery(q: string): number | null {
  const m = q.trim().match(/^(\d{6,})$/) ?? q.match(/-(\d{6,})\/?(?:[?#].*)?$/);
  return m ? Number(m[1]) : null;
}
