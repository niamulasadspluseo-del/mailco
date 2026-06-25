import { createFileRoute } from "@tanstack/react-router";
import { useStore, orders as ordersApi, type OrderStatus } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/admin/orders")({ component: OrdersAdmin });

const STATUSES: OrderStatus[] = ["Pending", "Payment Received", "Payment Not Received", "In Progress", "Ready For Delivery", "Delivered", "Refunded", "Cancel"];

function OrdersAdmin() {
  const orders = useStore((s) => s.orders);
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Orders ({orders.length})</h1>
      <div className="space-y-3">
        {orders.map((o) => (
          <Card key={o.id} className="p-4 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-0 space-y-0.5">
              <div className="font-medium truncate">{o.items.map((i) => i.title).join(", ")}</div>
              <div className="text-sm text-muted-foreground">{o.userName} · {o.userEmail}</div>
              <div className="text-xs text-muted-foreground">{new Date(o.createdAt).toLocaleString()}</div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span>{o.items.length} items</span>
                <span className="capitalize">{o.payment.method}</span>
                {o.payment.network && <span>{o.payment.network}</span>}
                {o.payment.txid && <span className="font-mono">TXID: {o.payment.txid}</span>}
                {o.telegram && <span>TG: {o.telegram}</span>}
                {o.whatsapp && <span>WA: {o.whatsapp}</span>}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="font-semibold">${o.total.toFixed(2)}</div>
              <Select value={o.status} onValueChange={(v: OrderStatus) => ordersApi.setStatus(o.id, v)}>
                <SelectTrigger className="w-44 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </Card>
        ))}
        {!orders.length && <Card className="p-8 text-center text-sm text-muted-foreground">No orders yet.</Card>}
      </div>
    </div>
  );
}
