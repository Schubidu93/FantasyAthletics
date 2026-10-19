import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Ziel des Magic Links. Unterstützt sowohl token_hash (empfohlenes Mail-Template)
// als auch den PKCE-Code (Standard-Template).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const supabase = await createClient();
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  const { error } = tokenHash && type
    ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    : code
      ? await supabase.auth.exchangeCodeForSession(code)
      : { error: new Error("Ungültiger Link") };

  return NextResponse.redirect(error ? `${origin}/login?error=link` : `${origin}/`);
}
