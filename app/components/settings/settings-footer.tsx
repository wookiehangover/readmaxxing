import { Link } from "react-router";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import { useAuth } from "~/lib/context/auth-context";

export function SettingsFooter() {
  const { isAuthenticated, logout } = useAuth();

  return (
    <footer className="mt-6 flex items-center justify-between gap-3 pt-2 text-xs md:mt-auto md:flex-col md:items-stretch">
      <Separator className="hidden md:block" />
      <div className="flex items-center justify-between gap-3 md:flex-col md:items-stretch">
        {isAuthenticated ? (
          <Button
            variant="link"
            className="h-auto justify-start px-0 text-xs"
            onClick={() => logout()}
          >
            Logout
          </Button>
        ) : (
          <Link to="/login" className="text-primary underline-offset-4 hover:underline">
            Login
          </Link>
        )}
        <Link
          to="/about"
          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          About
        </Link>
      </div>
    </footer>
  );
}
