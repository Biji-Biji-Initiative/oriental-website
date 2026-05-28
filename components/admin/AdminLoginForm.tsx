"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LockKeyholeIcon } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { adminLoginSchema } from "@/lib/schemas";

type AdminLoginValues = {
  token: string;
};

export function AdminLoginForm({ reason }: { reason?: string }) {
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<AdminLoginValues>({
    defaultValues: { token: "" },
    resolver: zodResolver(adminLoginSchema),
  });

  async function onSubmit(values: AdminLoginValues) {
    setSubmitting(true);
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        toast.error("Admin login failed.", {
          description: loginErrorCopy(body?.error ?? String(response.status)),
        });
        return;
      }
      toast.success("Admin session opened.");
      window.location.reload();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-svh place-items-center bg-mk-paper px-4 py-16 text-mk-off-black">
      <Card className="w-full max-w-md border-mk-ash/20 bg-white shadow-sm">
        <CardHeader>
          <div className="mb-2 grid size-10 place-items-center rounded-full bg-mk-horizon/15 text-mk-blue">
            <LockKeyholeIcon className="size-5" />
          </div>
          <CardTitle>Session review</CardTitle>
          <CardDescription>
            Enter the internal review token to inspect recent lead handoffs and voice transcripts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {reason === "unconfigured" ? (
            <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
              Admin review is not configured in this environment.
            </div>
          ) : null}
          <Form {...form}>
            <form className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
              <FormField
                control={form.control}
                name="token"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Review token</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        autoComplete="current-password"
                        placeholder="Paste admin review token"
                        type="password"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button disabled={submitting || reason === "unconfigured"} type="submit">
                {submitting ? "Opening..." : "Open dashboard"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </main>
  );
}

function loginErrorCopy(error: string) {
  if (error === "unconfigured") return "ADMIN_REVIEW_TOKEN is missing from this environment.";
  if (error === "invalid" || error === "missing") return "The token did not match the configured review token.";
  return "Please retry, then check the server logs if this keeps failing.";
}
