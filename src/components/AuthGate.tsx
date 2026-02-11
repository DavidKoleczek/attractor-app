import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/api";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ExternalLink, KeyRound, ChevronDown } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface AuthGateProps {
  children: ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getToken()
      .then(async (saved) => {
        if (cancelled || !saved) return;
        // Re-validate the token and populate the user in AppState.
        // Without this, the token string is restored but AppState.user
        // stays None, causing every command to fail.
        await api.setToken(saved);
        if (!cancelled) setAuthenticated(true);
      })
      .catch(() => {
        // Token missing or expired/revoked — stay on auth screen
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setError(null);
    try {
      await api.setToken(trimmed);
      setAuthenticated(true);
    } catch (err) {
      setError(
        typeof err === "string"
          ? err
          : err instanceof Error
            ? err.message
            : "Failed to validate token",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingSpinner size={32} label="Checking authentication..." />
      </div>
    );
  }

  if (authenticated) {
    return <>{children}</>;
  }

  return (
    <Dialog open={true}>
      <DialogContent
        className="sm:max-w-md"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="size-5" />
              GitHub Authentication
            </DialogTitle>
            <DialogDescription>
              Enter a fine-grained GitHub Personal Access Token to get started.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div className="rounded-md border border-border bg-muted/50 p-3 text-sm space-y-2">
              <a
                href="https://github.com/settings/personal-access-tokens/new?name=attractor-issues&description=Attractor+Issues+desktop+app"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-primary underline underline-offset-4 hover:text-primary/80"
              >
                Create a token on GitHub
                <ExternalLink className="size-3.5" />
              </a>
              <Collapsible>
                <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground [&[data-state=open]>svg]:rotate-180">
                  <ChevronDown className="size-3.5 transition-transform duration-200" />
                  Token permissions &amp; scope
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-2 text-xs text-muted-foreground">
                  <p>
                    <span className="font-medium text-foreground">Always required:</span>
                  </p>
                  <ul className="list-disc space-y-0.5 pl-4">
                    <li><strong>Contents</strong> &mdash; read &amp; write (push/pull project data)</li>
                    <li><strong>Metadata</strong> &mdash; read-only (granted automatically with any repo permission)</li>
                  </ul>
                  <p className="pt-1">
                    <span className="font-medium text-foreground">Only if you create repos from the app:</span>
                  </p>
                  <ul className="list-disc space-y-0.5 pl-4">
                    <li><strong>Administration</strong> &mdash; read &amp; write (GitHub&apos;s API requires this for repo creation)</li>
                    <li>If you create repos on github.com first and only open them here, you can skip Administration entirely.</li>
                  </ul>
                  <p className="pt-1">
                    <span className="font-medium text-foreground">Limiting repo scope:</span>
                  </p>
                  <ul className="list-disc space-y-0.5 pl-4">
                    <li>Under <strong>Repository access</strong>, choose &ldquo;Only select repositories&rdquo; to restrict the token to just your Attractor repos.</li>
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pat-input">Personal Access Token</Label>
              <Input
                id="pat-input"
                type="password"
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoFocus
                disabled={submitting}
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>

          <DialogFooter className="mt-6">
            <Button type="submit" disabled={submitting || !token.trim()}>
              {submitting ? (
                <>
                  <LoadingSpinner size={16} className="mr-2" />
                  Validating...
                </>
              ) : (
                "Connect"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
