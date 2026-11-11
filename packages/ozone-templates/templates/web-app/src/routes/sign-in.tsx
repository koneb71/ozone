import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { type SubmitEvent, useEffect, useState } from "react";
import { z } from "zod";
import { CenteredPage } from "@/components/centered-page";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { demoAccount } from "@/lib/demo";
import { site } from "@/lib/site";

const signInSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

const getDemoMode = createServerFn({ method: "GET" }).handler(
  () => process.env.OZONE_DEMO_ACCOUNT === "1",
);

/** Set once a browser has been signed in by itself, so signing out still works. */
const DEMO_USED_KEY = "demo-account-used";

/** Signs in as the demo account, creating it the first time. Returns what went wrong, if anything. */
async function signInWithDemo() {
  const signedIn = await authClient.signIn.email({
    email: demoAccount.email,
    password: demoAccount.password,
  });
  if (!signedIn.error) {
    return null;
  }
  const signedUp = await authClient.signUp.email(demoAccount);
  return signedUp.error ? (signedUp.error.message ?? "Could not use the demo account.") : null;
}

export const Route = createFileRoute("/sign-in")({
  head: () => ({ meta: [{ title: `Sign in · ${site.name}` }] }),
  loader: async () => ({ demo: await getDemoMode() }),
  component: SignIn,
});

function SignIn() {
  const navigate = useNavigate();
  const { demo } = Route.useLoaderData();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // In development the preview should open on the app, not on this form.
  useEffect(() => {
    if (!demo || sessionPending || session || localStorage.getItem(DEMO_USED_KEY) !== null) {
      return;
    }
    localStorage.setItem(DEMO_USED_KEY, "1");
    void signInWithDemo().then((problem) =>
      problem === null ? navigate({ to: "/" }) : setError(problem),
    );
  }, [demo, sessionPending, session, navigate]);

  async function continueWithDemo() {
    setError(null);
    setPending(true);
    const problem = await signInWithDemo();
    setPending(false);
    if (problem !== null) {
      setError(problem);
      return;
    }
    await navigate({ to: "/" });
  }

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = signInSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!input.success) {
      setError(input.error.issues[0].message);
      return;
    }
    setError(null);
    setPending(true);
    const result = await authClient.signIn.email(input.data);
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Could not sign in. Try again.");
      return;
    }
    await navigate({ to: "/" });
  }

  if (session) {
    return (
      <CenteredPage>
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>
              <h1>You are signed in</h1>
            </CardTitle>
            <CardDescription>{session.user.email}</CardDescription>
          </CardHeader>
          <CardFooter className="gap-2">
            <Link to="/" className={buttonVariants()}>
              Continue
            </Link>
            <Button variant="outline" onClick={() => authClient.signOut()}>
              Sign out
            </Button>
          </CardFooter>
        </Card>
      </CenteredPage>
    );
  }

  return (
    <CenteredPage>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <h1>Sign in</h1>
          </CardTitle>
          <CardDescription>Enter your email and password to continue.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? "Signing in..." : "Sign in"}
            </Button>
            {demo && (
              <Button type="button" variant="outline" disabled={pending} onClick={continueWithDemo}>
                Continue with the demo account
              </Button>
            )}
          </form>
        </CardContent>
        <CardFooter className="justify-center gap-1 text-sm text-muted-foreground">
          No account yet?
          <Link to="/sign-up" className="font-medium text-foreground underline underline-offset-4">
            Sign up
          </Link>
        </CardFooter>
      </Card>
    </CenteredPage>
  );
}
