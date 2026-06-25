import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { auth, useStore } from "@/lib/store";
import { SiteLayout } from "@/components/layout/SiteLayout";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({ component: AuthPage });

function AuthPage() {
  const nav = useNavigate();
  const session = useStore((s) => s.sessionUserId);
  useEffect(() => { if (session) nav({ to: "/account" }); }, [session, nav]);

  return (
    <SiteLayout>
      <div className="container mx-auto max-w-md px-4 py-16">
        <Card className="p-6">
          <Tabs defaultValue="login">
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="login">Login</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
              <TabsTrigger value="forgot">Forgot</TabsTrigger>
            </TabsList>
            <TabsContent value="login"><LoginForm /></TabsContent>
            <TabsContent value="signup"><SignupForm /></TabsContent>
            <TabsContent value="forgot"><ForgotForm /></TabsContent>
          </Tabs>

        </Card>
      </div>
    </SiteLayout>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const nav = useNavigate();
  return (
    <form className="mt-6 space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      try { const u = await auth.login(email, password); toast.success("Welcome back!"); nav({ to: u.role === "admin" ? "/admin" : "/account" }); }
      catch (err: any) { toast.error(err.message); }
    }}>
      <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
      <div><Label>Password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
      <Button type="submit" className="w-full">Login</Button>
    </form>
  );
}
function SignupForm() {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const nav = useNavigate();
  return (
    <form className="mt-6 space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      try {
        await auth.signup(form.name, form.email, form.password);
        toast.success("Account created successfully!");
        nav({ to: "/account" });
      }
      catch (err: any) { toast.error(err.message); }
    }}>
      <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
      <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
      <div><Label>Password</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} /></div>
      <Button type="submit" className="w-full">Create account</Button>
    </form>
  );
}
function ForgotForm() {
  const nav = useNavigate();
  return (
    <div className="mt-6 space-y-4 text-center">
      <p className="text-muted-foreground">If you forgot your password, please contact us to reset it.</p>
      <Button className="w-full" onClick={() => nav({ to: "/contact" })}>Contact With Us For Reset Password</Button>
    </div>
  );
}
