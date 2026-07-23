"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import { LogIn } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { useAuthSession } from "@/lib/auth-provider";
import {
  COLLEGE_LOGO,
  COLLEGE_NAME,
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

/**
 * Full-screen login. Authenticates against the FastAPI backend (JWT); on
 * success the token is stored and the app shell renders.
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
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-6">
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
            <p className="text-balance text-xs text-muted-foreground">
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
                <Input
                  id="login-password"
                  type="password"
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
            College website
          </a>
        </p>
      </div>
    </div>
  );
}
