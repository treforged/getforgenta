import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Compass, ArrowLeft } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useDemo } from "@/contexts/DemoContext";
import ForgentaLogo from "@/components/shared/ForgentaLogo";

// A wrong address should look like a wrong address, not like a broken app.
// So this page is branded, says which path was not found, and always offers
// somewhere real to go — signed in, that is the dashboard; signed out, home.
const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isDemo } = useDemo();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  const signedIn = Boolean(user) || isDemo;
  const homeTo = signedIn ? "/dashboard" : "/";
  const homeLabel = signedIn ? "Go to dashboard" : "Go to homepage";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm text-center">
        <div className="flex justify-center mb-8">
          <ForgentaLogo />
        </div>

        <div className="flex justify-center mb-4">
          <div className="p-3 bg-secondary border border-border" style={{ borderRadius: 'var(--radius)' }}>
            <Compass size={24} className="text-primary" />
          </div>
        </div>

        <h1 className="font-display text-3xl font-bold tracking-tight">Page not found</h1>
        <p className="text-sm text-muted-foreground mt-2">
          We couldn’t find anything at that address. Your account and your data are fine — this is
          just a link that doesn’t go anywhere.
        </p>

        <p
          className="mt-4 px-3 py-2 text-xs font-mono text-muted-foreground bg-secondary border border-border break-all"
          style={{ borderRadius: 'var(--radius)' }}
        >
          {location.pathname}
        </p>

        <div className="mt-8 flex flex-col gap-2">
          <Link
            to={homeTo}
            className="w-full px-4 py-2.5 text-xs font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            style={{ borderRadius: 'var(--radius)' }}
          >
            {homeLabel}
          </Link>
          <button
            onClick={() => navigate(-1)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium border border-border hover:border-primary/40 hover:text-primary transition-colors"
            style={{ borderRadius: 'var(--radius)' }}
          >
            <ArrowLeft size={12} /> Go back
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
