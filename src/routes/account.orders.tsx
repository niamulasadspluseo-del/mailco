import { createFileRoute, Link } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/account/orders")({ component: Orders });

function Orders() {
  const userId = useStore((s) => s.sessionUserId)!;
  const orders = useStore((s) => s.orders.filter((o) => o.userId === userId));
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">My Orders ({orders.length})</h1>
      <div className="space-y-4">
        {orders.map((o) => (
          <Link key={o.id} to="/account/orders/$id" params={{ id: o.id }} className="block">
            <Card className="p-5 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 hover:shadow-md transition-shadow">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{o.items.map((i) => i.title).join(", ")}</div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-sm text-muted-foreground">
                  <span>{new Date(o.createdAt).toLocaleDateString()}</span>
                  <span>{o.items.length} item{o.items.length > 1 ? "s" : ""}</span>
                  {o.payment.txid && <span className="font-mono text-xs">TXID: {o.payment.txid}</span>}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="font-semibold text-lg">${o.total.toFixed(2)}</span>
                <Badge variant={o.status === "Delivered" ? "default" : o.status === "Refunded" || o.status === "Cancel" || o.status === "Payment Not Received" ? "destructive" : "secondary"}>{o.status}</Badge>
              </div>
            </Card>
          </Link>
        ))}
        {!orders.length && <Card className="p-8 text-center text-sm text-muted-foreground">No orders yet.</Card>}
      </div>
    </div>
  );
}
