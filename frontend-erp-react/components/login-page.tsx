"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import { ExternalLink, LogIn, MapPin } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { useAuthSession } from "@/lib/auth-provider";
import {
  COLLEGE_ADDRESS,
  COLLEGE_LOGO,
  COLLEGE_NAME,
  COLLEGE_PHOTOS,
  COLLEGE_TAGLINE,
  COLLEGE_WEBSITE,
} from "@/lib/branding";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

const [HERO, ...THUMBS] = COLLEGE_PHOTOS;
const WEBSITE_HOST = new URL(COLLEGE_WEBSITE).host;

/**
 * Full-screen login. Authenticates against the FastAPI backend (JWT); on
 * success the token is stored and the app shell renders.
 *
 * Wide screens split into a campus photo panel (identity + a link to the
 * college site) and the form; narrow ones show the photo as a banner above it.
 */
export function LoginPage() {
  const { login } = useAuthSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);

  const signIn = async (e: string, p: string) => {
    setPending(true);
    try {
      await login(e, p);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.detail
          : "Couldn't sign in. Is the backend running?";
      toast.error(msg);
    } finally {
      setPending(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      toast.error("Enter your email and password.");
      return;
    }
    void signIn(email, password);
  };

  return (
    <div className="grid min-h-svh bg-muted/40 lg:grid-cols-2">
      {/* Photo panel — wide screens only */}
      <aside className="relative hidden overflow-hidden lg:block">
        <Image
          src={HERO.src}
          alt={HERO.alt}
          fill
          sizes="50vw"
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/20" />
        <div className="relative flex h-full flex-col justify-between p-10 text-white">
          <div className="flex items-center gap-3">
            <div className="relative size-14 shrink-0 rounded-full bg-white/95 p-1.5">
              <div className="relative size-full">
                <Image
                  src={COLLEGE_LOGO}
                  alt={`${COLLEGE_NAME} crest`}
                  fill
                  sizes="56px"
                  className="object-contain"
                />
              </div>
            </div>
            <span className="text-sm font-medium tracking-wide text-white/90">
              {COLLEGE_NAME}
            </span>
          </div>

          <div className="space-y-6">
            <div className="space-y-3">
              <h2 className="max-w-lg text-balance text-3xl font-semibold leading-tight">
                {COLLEGE_TAGLINE}
              </h2>
              <p className="flex items-center gap-1.5 text-sm text-white/80">
                <MapPin className="size-4" />
                {COLLEGE_ADDRESS}
              </p>
            </div>
            <div className="flex gap-3">
              {THUMBS.map((p) => (
                <div
                  key={p.src}
                  className="relative h-20 w-32 overflow-hidden rounded-lg ring-1 ring-white/30"
                >
                  <Image
                    src={p.src}
                    alt={p.alt}
                    fill
                    sizes="128px"
                    className="object-cover"
                  />
                </div>
              ))}
            </div>
            <a
              href={COLLEGE_WEBSITE}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-medium backdrop-blur transition-colors hover:bg-white/25"
            >
              Visit {WEBSITE_HOST}
              <ExternalLink className="size-4" />
            </a>
          </div>
        </div>
      </aside>

      <main className="flex flex-col">
        {/* Banner — narrow screens only */}
        <div className="relative h-40 lg:hidden">
          <Image
            src={HERO.src}
            alt={HERO.alt}
            fill
            sizes="100vw"
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-muted/95 to-black/10" />
        </div>

        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-sm space-y-4">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="relative size-16 shrink-0">
                <Image
                  src={COLLEGE_LOGO}
                  alt={`${COLLEGE_NAME} crest`}
                  fill
                  sizes="64px"
                  className="object-contain"
                  priority
                />
              </div>
              <div className="space-y-1">
                <h1 className="text-balance text-lg font-semibold leading-tight">
                  {COLLEGE_NAME}
                </h1>
                <p className="text-balance text-xs text-muted-foreground lg:hidden">
                  {COLLEGE_TAGLINE}
                </p>
              </div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Sign in</CardTitle>
                <CardDescription>
                  Use the account issued to you by the college office.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={submit} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-email">Email</Label>
                    <Input
                      id="login-email"
                      type="email"
                      autoComplete="username"
                      placeholder="you@scascollege.ac.in"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={pending}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Password</Label>
                    <PasswordInput
                      id="login-password"
                      autoComplete="current-password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={pending}
                    />
                  </div>
                  <Button type="submit" className="w-full" loading={pending}>
                    {pending ? null : <LogIn />}
                    {pending ? "Signing in…" : "Sign in"}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <p className="text-center text-xs text-muted-foreground">
              Forgotten your password? Contact the college office.
              {" · "}
              <a
                href={COLLEGE_WEBSITE}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                {WEBSITE_HOST}
              </a>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
