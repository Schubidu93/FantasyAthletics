"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  // Code-Eingabe ist wichtig für die installierte App auf dem iPhone: Links aus der
  // Mail öffnen sich dort in Safari statt in der App.
  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.verifyOtp({ email, token: code.trim(), type: "email" });
    setBusy(false);
    if (error) setError(error.message);
    else {
      router.replace("/");
      router.refresh();
    }
  }

  return (
    <div className="mx-auto mt-10 max-w-sm space-y-4">
      <h1 className="h1">Anmelden</h1>
      {!sent ? (
        <form onSubmit={sendLink} className="card space-y-3">
          <div>
            <label className="label" htmlFor="email">E-Mail</label>
            <input id="email" type="email" required autoComplete="email" className="input"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button className="btn w-full" disabled={busy}>Login-Link senden</button>
        </form>
      ) : (
        <form onSubmit={verifyCode} className="card space-y-3">
          <p className="muted">
            Wir haben dir eine Mail an <b>{email}</b> geschickt. Klicke auf den Link oder gib den Code aus der Mail ein.
          </p>
          <div>
            <label className="label" htmlFor="code">Code</label>
            <input id="code" inputMode="numeric" autoComplete="one-time-code" className="input tracking-widest"
              value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <button className="btn w-full" disabled={busy || code.trim().length < 6}>Einloggen</button>
          <button type="button" className="btn-secondary w-full" onClick={() => setSent(false)}>Andere E-Mail</button>
        </form>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
