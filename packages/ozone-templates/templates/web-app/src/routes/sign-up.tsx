import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type SubmitEvent, useState } from "react";
import { z } from "zod";
import { CenteredPage } from "@/components/centered-page";
import { Button } from "@/components/ui/button";
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
import { site } from "@/lib/site";

const signUpSchema = z.object({
  name: z.string().trim().min(1, "Enter your name."),
  email: z.email("Enter a valid email address."),
  password: z.string().min(8, "Use a password with at least 8 characters."),
});

export const Route = createFileRoute("/sign-up")({
  head: () => ({ meta: [{ title: `Sign up · ${site.name}` }] }),
  component: SignUp,
});

function SignUp() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = signUpSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!input.success) {
      setError(input.error.issues[0].message);
      return;
    }
    setError(null);
    setPending(true);
    const result = await authClient.signUp.email(input.data);
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Could not create the account. Try again.");
      return;
    }
    await navigate({ to: "/" });
  }

  return (
    <CenteredPage>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <h1>Create an account</h1>
          </CardTitle>
          <CardDescription>Enter your details to get started.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" autoComplete="name" required />
            </div>
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
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? "Creating account..." : "Create account"}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="justify-center gap-1 text-sm text-muted-foreground">
          Already have an account?
          <Link to="/sign-in" className="font-medium text-foreground underline underline-offset-4">
            Sign in
          </Link>
        </CardFooter>
      </Card>
    </CenteredPage>
  );
}
