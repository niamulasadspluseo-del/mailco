// Supabase-backed store with the same API surface as the previous local one.
// Components keep calling useStore / auth / cart / orders / admin unchanged;
// reads come from an in-memory cache that is hydrated from Supabase and kept
// fresh by Postgres-changes realtime subscriptions; writes go through Supabase.
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/shim/with-selector";
import { supabase } from "@/integrations/supabase/client";

export type Role = "admin" | "customer";
export type UserStatus = "active" | "suspended" | "banned";
export type OrderStatus = "Pending" | "Payment Received" | "Payment Not Received" | "In Progress" | "Ready For Delivery" | "Delivered" | "Refunded" | "Cancel";

export interface User {
  id: string; name: string; email: string; password: string;
  role: Role; status: UserStatus; verified: boolean;
  billing?: { country?: string; address?: string; city?: string; zip?: string };
  createdAt: number;
}
export interface Variation { id: string; name: string; price: number }
export interface Product {
  id: string; slug: string; title: string; description: string;
  price: number; salePrice?: number;
  category: string; tags: string[];
  image: string; gallery?: string[];
  fileUrl: string;
  variations: Variation[];
  featured?: boolean; newRelease?: boolean; bestSeller?: boolean;
  createdAt: number;
}
export interface Category { id: string; name: string; slug: string; icon?: string }
export interface CartItem { productId: string; variationId?: string; qty: number }
export interface Cart { items: CartItem[]; couponCode?: string }
export interface OrderItem { productId: string; title: string; price: number; qty: number; variationName?: string; fileUrl: string }
export interface Order {
  id: string; userId: string; userName: string; userEmail: string;
  telegram?: string; whatsapp?: string;
  items: OrderItem[]; subtotal: number; discount: number; total: number;
  status: OrderStatus;
  payment: { method: "stripe" | "crypto"; txid?: string; network?: string; cardLast4?: string };
  createdAt: number;
}
export interface Coupon {
  code: string; type: "percent" | "fixed"; value: number;
  expiresAt?: number; usageLimit?: number; usedCount: number;
}
export interface Review { id: string; productId: string; userId: string; userName: string; rating: number; text: string; approved: boolean; createdAt: number }
export interface BlogPost { id: string; slug: string; title: string; excerpt: string; content: string; cover: string; author: string; publishedAt: number }
export interface Testimonial { id: string; name: string; role: string; text: string; avatar?: string; rating: number }
export interface FAQ { id: string; question: string; answer: string }
export interface Pages { terms: string; privacy: string; refund: string; about: string; contact: string }
export interface CryptoNetwork { id: string; name: string; chain: string; address: string }
export interface Settings {
  brand: { name: string; logo?: string; favicon?: string; metaTitle: string; metaDesc: string };
  hero: { eyebrow: string; title: string; subtitle: string; ctaText: string };
  integrations: { ga4?: string; gtm?: string; metaPixel?: string; googleAdsId?: string; tiktokPixel?: string; clarityId?: string; headerScript?: string; footerScript?: string };
  payments: {
    stripe: { enabled: boolean; publishableKey?: string; secretKey?: string };
    crypto: { enabled: boolean; networks: CryptoNetwork[] };
  };
}
export interface ContactMessage { id: string; name: string; email: string; message: string; read: boolean; createdAt: number }

interface DB {
  users: User[]; sessionUserId: string | null;
  products: Product[]; categories: Category[]; tags: string[];
  orders: Order[]; coupons: Coupon[]; reviews: Review[];
  blog: BlogPost[]; testimonials: Testimonial[]; faqs: FAQ[];
  pages: Pages; settings: Settings; cart: Cart;
  contactMessages: ContactMessage[];
  ready: boolean;
}

const CART_KEY = "ds.cart.v1";
const SETTINGS_KEY = "ds.settings.v1";
const isBrowser = typeof window !== "undefined";

const defaultSettings: Settings = {
  brand: { name: "PixelMart", metaTitle: "PixelMart — Premium Digital Products", metaDesc: "Templates, ebooks, software and courses for creators and founders." },
  hero: { eyebrow: "Premium Digital Goods", title: "Build faster with battle-tested digital products", subtitle: "Templates, ebooks, software and courses crafted by working pros. Instant download, lifetime updates.", ctaText: "Shop products" },
  integrations: {},
  payments: { stripe: { enabled: true }, crypto: { enabled: true, networks: [] } },
};

const empty = (): DB => ({
  users: [], sessionUserId: null,
  products: [], categories: [], tags: [],
  orders: [], coupons: [], reviews: [],
  blog: [], testimonials: [], faqs: [],
  pages: { terms: "", privacy: "", refund: "", about: "", contact: "" },
  settings: defaultSettings,
  cart: { items: [] },
  contactMessages: [],
  ready: false,
});

let db: DB = empty();

// Cart is restored from localStorage inside hydrate() so SSR and the first
// client render agree (no hydration mismatch on the cart badge).

const listeners = new Set<() => void>();
function emit() {
  db = { ...db,
    users: [...db.users], products: [...db.products], categories: [...db.categories], tags: [...db.tags],
    orders: [...db.orders], coupons: [...db.coupons], reviews: [...db.reviews],
    blog: [...db.blog], testimonials: [...db.testimonials], faqs: [...db.faqs],
    pages: { ...db.pages }, settings: { ...db.settings },
    cart: { ...db.cart, items: [...db.cart.items] },
    contactMessages: [...db.contactMessages],
  };
  if (isBrowser) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(db.cart)); } catch {}
  }
  listeners.forEach((l) => l());
}

export function subscribe(fn: () => void) {
  if (isBrowser && !hydrated) hydrate();
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function snapshot(): DB { return db; }
function shallowEq(a: any, b: any): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.is(a[k], b[k])) return false;
  return true;
}
export function useStore<T>(selector: (s: DB) => T): T {
  return useSyncExternalStoreWithSelector(subscribe, () => db, () => db, selector, shallowEq);
}

// ---------- Mapping helpers ----------
const ts = (d: string | null | undefined) => d ? new Date(d).getTime() : Date.now();
const statusOut = (s: string): OrderStatus => ({
  pending: "Pending", payment_received: "Payment Received", payment_not_received: "Payment Not Received",
  in_progress: "In Progress", ready_for_delivery: "Ready For Delivery",
  delivered: "Delivered", refunded: "Refunded", cancel: "Cancel",
} as Record<string, OrderStatus>)[s] ?? "Pending";
const statusIn = (s: OrderStatus): string => ({
  "Pending": "pending", "Payment Received": "payment_received", "Payment Not Received": "payment_not_received",
  "In Progress": "in_progress", "Ready For Delivery": "ready_for_delivery",
  "Delivered": "delivered", "Refunded": "refunded", "Cancel": "cancel",
}[s]);

function rowToProduct(r: any): Product {
  return {
    id: r.id, slug: r.slug, title: r.title, description: r.description ?? "",
    price: Number(r.price), salePrice: r.sale_price != null ? Number(r.sale_price) : undefined,
    category: r.category_slug ?? "", tags: r.tags ?? [],
    image: r.image ?? "", gallery: r.gallery ?? [],
    fileUrl: r.file_url ?? "", variations: r.variations ?? [],
    featured: !!r.featured, newRelease: !!r.new_release, bestSeller: !!r.best_seller,
    createdAt: ts(r.created_at),
  };
}
function productToRow(p: Product): any {
  const row: any = {
    slug: p.slug || p.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
    title: p.title, description: p.description,
    price: p.price, sale_price: p.salePrice ?? null,
    category_slug: p.category, tags: p.tags, image: p.image, gallery: p.gallery ?? [],
    file_url: p.fileUrl, variations: p.variations,
    featured: !!p.featured, new_release: !!p.newRelease, best_seller: !!p.bestSeller,
  };
  if (p.id) row.id = p.id;
  return row;
}
function rowToOrder(r: any): Order {
  const meta = r.payment_meta ?? {};
  return {
    id: r.id, userId: r.user_id ?? "", userName: r.user_name ?? "", userEmail: r.user_email ?? "",
    telegram: r.telegram ?? undefined, whatsapp: r.whatsapp ?? undefined,
    items: r.items ?? [], subtotal: Number(r.subtotal), discount: Number(r.discount), total: Number(r.total),
    status: statusOut(r.status),
    payment: { method: r.payment_method ?? "stripe", txid: r.payment_txid ?? undefined, network: meta.network, cardLast4: meta.cardLast4 },
    createdAt: ts(r.created_at),
  };
}
function rowToCoupon(r: any): Coupon {
  return { code: r.code, type: r.type, value: Number(r.value),
    expiresAt: r.expires_at ? new Date(r.expires_at).getTime() : undefined,
    usageLimit: r.usage_limit ?? undefined, usedCount: r.used_count };
}
function rowToReview(r: any): Review {
  return { id: r.id, productId: r.product_id, userId: r.user_id, userName: r.user_name ?? "User",
    rating: r.rating, text: r.text ?? "", approved: !!r.approved, createdAt: ts(r.created_at) };
}
function rowToBlog(r: any): BlogPost {
  return { id: r.id, slug: r.slug, title: r.title, excerpt: r.excerpt ?? "", content: r.content ?? "",
    cover: r.cover ?? "", author: r.author ?? "", publishedAt: ts(r.published_at ?? r.created_at) };
}
function rowToTestimonial(r: any): Testimonial {
  return { id: r.id, name: r.name, role: r.role ?? "", text: r.text, avatar: r.avatar ?? undefined, rating: r.rating ?? 5 };
}
function rowToFaq(r: any): FAQ { return { id: r.id, question: r.question, answer: r.answer }; }
function rowToCategory(r: any): Category { return { id: r.id, name: r.name, slug: r.slug, icon: r.icon ?? undefined }; }
function rowToMessage(r: any): ContactMessage {
  return { id: r.id, name: r.name, email: r.email, message: r.message, read: !!r.read, createdAt: ts(r.created_at) };
}

// ---------- Hydration ----------
let hydrated = false;
let currentProfile: { id: string; name: string; email: string; status: UserStatus; billing?: any; createdAt: number } | null = null;
let currentRole: Role = "customer";
let settingsSavePending = false;

async function loadPublicData() {
  const [products, categories, tags, coupons, reviews, blog, testimonials, faqs, pages, settings] = await Promise.all([
    supabase.from("products").select("*").order("created_at", { ascending: false }),
    supabase.from("categories").select("*").order("name"),
    supabase.from("tags").select("name").order("name"),
    supabase.from("coupons").select("*"),
    supabase.from("reviews").select("*").order("created_at", { ascending: false }),
    supabase.from("blog_posts").select("*").order("published_at", { ascending: false }),
    supabase.from("testimonials").select("*").order("created_at", { ascending: false }),
    supabase.from("faqs").select("*").order("sort_order"),
    supabase.from("pages").select("*"),
    supabase.from("settings").select("*").eq("id", "singleton").maybeSingle(),
  ]);
  db.products = (products.data ?? []).map(rowToProduct);
  db.categories = (categories.data ?? []).map(rowToCategory);
  db.tags = (tags.data ?? []).map((t: any) => t.name);
  db.coupons = (coupons.data ?? []).map(rowToCoupon);
  db.reviews = (reviews.data ?? []).map(rowToReview);
  db.blog = (blog.data ?? []).map(rowToBlog);
  db.testimonials = (testimonials.data ?? []).map(rowToTestimonial);
  db.faqs = (faqs.data ?? []).map(rowToFaq);
  const pageMap: Pages = { terms: "", privacy: "", refund: "", about: "", contact: "" };
  for (const p of pages.data ?? []) {
    if (p.slug in pageMap) (pageMap as any)[p.slug] = p.content ?? "";
  }
  db.pages = pageMap;
  if (settings.data) {
    const s = settings.data as any;
    db.settings = {
      brand: { ...defaultSettings.brand, ...(s.brand ?? {}) },
      hero: { ...defaultSettings.hero, ...(s.hero ?? {}) },
      integrations: s.integrations ?? {},
      payments: {
        stripe: { enabled: true, ...(s.payments?.stripe ?? {}) },
        crypto: { enabled: true, networks: [], ...(s.payments?.crypto ?? {}) },
      },
    };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(db.settings)); } catch {}
  }
}

async function loadUserScopedData() {
  const uid = db.sessionUserId;
  if (!uid) {
    db.users = currentProfile ? [profileToUser(currentProfile, currentRole)] : [];
    db.orders = [];
    db.contactMessages = [];
    return;
  }
  // For admins, load every profile + every role + every order + messages.
  if (currentRole === "admin") {
    const [profiles, roles, orders, messages] = await Promise.all([
      supabase.from("profiles").select("*"),
      supabase.from("user_roles").select("*"),
      supabase.from("orders").select("*").order("created_at", { ascending: false }),
      supabase.from("contact_messages").select("*").order("created_at", { ascending: false }),
    ]);
    const roleMap = new Map<string, Role>();
    for (const r of roles.data ?? []) roleMap.set(r.user_id, r.role);
    db.users = (profiles.data ?? []).map((p: any) => profileToUser(p, roleMap.get(p.id) ?? "customer"));
    db.orders = (orders.data ?? []).map(rowToOrder);
    db.contactMessages = (messages.data ?? []).map(rowToMessage);
  } else {
    const orders = await supabase.from("orders").select("*").eq("user_id", uid).order("created_at", { ascending: false });
    db.users = currentProfile ? [profileToUser(currentProfile, currentRole)] : [];
    db.orders = (orders.data ?? []).map(rowToOrder);
    db.contactMessages = [];
  }
}

function profileToUser(p: any, role: Role): User {
  return {
    id: p.id, name: p.name ?? p.email ?? "User", email: p.email ?? "", password: "",
    role, status: p.status ?? "active", verified: true, billing: p.billing ?? undefined,
    createdAt: ts(p.created_at ?? p.createdAt),
  };
}

async function resolveSession() {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user ?? null;
  db.sessionUserId = user?.id ?? null;
  if (user) {
    const [prof, roles] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", user.id),
    ]);
    currentProfile = prof.data ? { id: prof.data.id, name: prof.data.name ?? "", email: prof.data.email ?? "", status: (prof.data.status ?? "active") as UserStatus, billing: prof.data.billing, createdAt: ts(prof.data.created_at) } : null;
    currentRole = (roles.data ?? []).some((r: any) => r.role === "admin") ? "admin" : "customer";
  } else {
    currentProfile = null; currentRole = "customer";
  }
}

function setupRealtime() {
  const tables = ["products", "categories", "tags", "coupons", "reviews", "blog_posts", "testimonials", "faqs", "pages", "settings"];
  const channel = supabase.channel("public-changes");
  for (const t of tables) {
    channel.on("postgres_changes" as any, { event: "*", schema: "public", table: t }, async () => {
      if (t === "settings" && settingsSavePending) return;
      await loadPublicData(); emit();
    });
  }
  channel.on("postgres_changes" as any, { event: "*", schema: "public", table: "orders" }, async () => {
    await loadUserScopedData(); emit();
  });
  channel.on("postgres_changes" as any, { event: "*", schema: "public", table: "contact_messages" }, async () => {
    if (currentRole === "admin") { await loadUserScopedData(); emit(); }
  });
  channel.subscribe();
}

export function hydrate() {
  if (!isBrowser || hydrated) return;
  hydrated = true;
  (async () => {
    try { const raw = localStorage.getItem(CART_KEY); if (raw) db.cart = JSON.parse(raw); } catch {}
    try { const raw = localStorage.getItem(SETTINGS_KEY); if (raw) { db.settings = JSON.parse(raw); emit(); } } catch {}
    await resolveSession();
    await Promise.all([loadPublicData(), loadUserScopedData()]);
    db.ready = true;
    emit();
    setupRealtime();
    supabase.auth.onAuthStateChange(async (_evt, session) => {
      db.sessionUserId = session?.user?.id ?? null;
      if (session?.user) {
        const [prof, roles] = await Promise.all([
          supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle(),
          supabase.from("user_roles").select("role").eq("user_id", session.user.id),
        ]);
        currentProfile = prof.data ? { id: prof.data.id, name: prof.data.name ?? "", email: prof.data.email ?? "", status: (prof.data.status ?? "active") as UserStatus, billing: prof.data.billing, createdAt: ts(prof.data.created_at) } : null;
        currentRole = (roles.data ?? []).some((r: any) => r.role === "admin") ? "admin" : "customer";
      } else {
        currentProfile = null; currentRole = "customer";
      }
      await loadUserScopedData();
      emit();
    });
  })();
}

// ---------- Auth ----------
export const auth = {
  async signup(name: string, email: string, password: string) {
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { emailRedirectTo: window.location.origin, data: { name } },
    });
    if (error) throw new Error(error.message);
    if (!data.user || !data.user.identities?.length) throw new Error("An account with this email already exists");
    return { id: data.user.id, name, email, password: "", role: "customer" as Role, status: "active" as UserStatus, verified: !!data.session, createdAt: Date.now() } as User;
  },
  async login(loginEmail: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });
    if (error) throw new Error(error.message);
    if (!data.user) throw new Error("Invalid credentials");
    await resolveSession();
    await loadUserScopedData();
    emit();
    const user = profileToUser(currentProfile ?? { id: data.user.id, name: data.user.user_metadata?.name ?? data.user.email, email: data.user.email, status: "active", created_at: data.user.created_at }, currentRole);
    if (user.email.toLowerCase() !== loginEmail.toLowerCase()) {
      await supabase.auth.signOut();
      db.sessionUserId = null; currentProfile = null; currentRole = "customer";
      emit();
      throw new Error("Login failed: email mismatch. Please contact support.");
    }
    if (user.status === "banned") {
      await supabase.auth.signOut();
      db.sessionUserId = null; currentProfile = null; currentRole = "customer";
      emit();
      throw new Error("Your account is banned. Please contact us.");
    }
    return user;
  },
  async logout() {
    await supabase.auth.signOut();
    db.sessionUserId = null; currentProfile = null; currentRole = "customer";
    db.users = []; db.orders = []; db.contactMessages = [];
    emit();
  },
  async forgot(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + "/auth" });
    if (error) throw new Error(error.message);
    return true;
  },
  verify(_userId: string) { /* email verification handled by Supabase */ },
  current(): User | null {
    if (!db.sessionUserId || !currentProfile) return null;
    return profileToUser(currentProfile, currentRole);
  },
  async updateProfile(patch: Partial<User>) {
    if (!db.sessionUserId) return;
    const row: any = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.email !== undefined) row.email = patch.email;
    if (patch.billing !== undefined) row.billing = patch.billing;
    if (Object.keys(row).length === 0) return;
    const { error } = await supabase.from("profiles").update(row).eq("id", db.sessionUserId);
    if (error) { console.error(error); return; }
    if (currentProfile) Object.assign(currentProfile, row);
    db.users = db.users.map((u) => u.id === db.sessionUserId ? { ...u, ...patch } : u);
    emit();
  },
};

// ---------- Cart (local) ----------
export const cart = {
  add(productId: string, variationId?: string, qty = 1, openDrawer = true) {
    const items = db.cart.items.slice();
    const idx = items.findIndex((i) => i.productId === productId && i.variationId === variationId);
    if (idx >= 0) items[idx] = { ...items[idx], qty: items[idx].qty + qty };
    else items.push({ productId, variationId, qty });
    db.cart = { ...db.cart, items }; emit(); if (openDrawer) cartDrawer.open();
  },
  remove(productId: string, variationId?: string) {
    db.cart = { ...db.cart, items: db.cart.items.filter((i) => !(i.productId === productId && i.variationId === variationId)) };
    emit();
  },
  setQty(productId: string, variationId: string | undefined, qty: number) {
    db.cart = { ...db.cart, items: db.cart.items.map((i) => i.productId === productId && i.variationId === variationId ? { ...i, qty: Math.max(1, qty) } : i) };
    emit();
  },
  clear() { db.cart = { items: [] }; emit(); },
  applyCoupon(code: string) {
    const c = db.coupons.find((x) => x.code.toLowerCase() === code.toLowerCase());
    if (!c) throw new Error("Invalid coupon");
    if (c.expiresAt && c.expiresAt < Date.now()) throw new Error("Coupon expired");
    if (c.usageLimit && c.usedCount >= c.usageLimit) throw new Error("Coupon limit reached");
    db.cart = { ...db.cart, couponCode: c.code }; emit();
  },
  removeCoupon() { db.cart = { ...db.cart, couponCode: undefined }; emit(); },
};

export function totals(c: Cart = db.cart) {
  const items = c.items.map((it) => {
    const p = db.products.find((x) => x.id === it.productId);
    if (!p) return null;
    const v = it.variationId ? p.variations.find((x) => x.id === it.variationId) : undefined;
    const price = v?.price ?? p.salePrice ?? p.price;
    return { product: p, variation: v, qty: it.qty, line: price * it.qty, unit: price };
  }).filter(Boolean) as Array<{ product: Product; variation?: Variation; qty: number; line: number; unit: number }>;
  const subtotal = items.reduce((s, i) => s + i.line, 0);
  let discount = 0;
  const coupon = c.couponCode ? db.coupons.find((x) => x.code === c.couponCode) : undefined;
  if (coupon) discount = coupon.type === "percent" ? subtotal * (coupon.value / 100) : Math.min(subtotal, coupon.value);
  return { items, subtotal, discount, total: Math.max(0, subtotal - discount), coupon };
}

// ---------- Orders ----------
export const orders = {
  async create(payment: Order["payment"], contact?: { name: string; email: string; telegram?: string; whatsapp?: string }) {
    const user = auth.current(); if (!user) throw new Error("Login required");
    if (user.status === "suspended") throw new Error("Your account is suspended. Please contact us.");
    if (user.status === "banned") throw new Error("Your account is banned. Please contact us.");
    const t = totals(); if (!t.items.length) throw new Error("Cart is empty");
    const items: OrderItem[] = t.items.map((i) => ({
      productId: i.product.id, title: i.product.title, price: i.unit, qty: i.qty,
      variationName: i.variation?.name, fileUrl: i.product.fileUrl,
    }));
    const { data, error } = await supabase.from("orders").insert({
      user_id: user.id, user_name: contact?.name ?? user.name, user_email: contact?.email ?? user.email,
      telegram: contact?.telegram ?? null, whatsapp: contact?.whatsapp ?? null,
      items: items as any, subtotal: t.subtotal, discount: t.discount, total: t.total,
      coupon_code: t.coupon?.code ?? null, status: "pending",
      payment_method: payment.method, payment_txid: payment.txid ?? null,
      payment_meta: { network: payment.network ?? null, cardLast4: payment.cardLast4 ?? null } as any,
    } as any).select().single();
    if (error || !data) throw new Error(error?.message ?? "Failed to create order");
    if (t.coupon) {
      await supabase.from("coupons").update({ used_count: t.coupon.usedCount + 1 }).eq("code", t.coupon.code);
    }
    const order = rowToOrder(data);
    db.orders = [order, ...db.orders];
    db.cart = { items: [] };
    emit();
    return order;
  },
  async setStatus(id: string, status: OrderStatus) {
    db.orders = db.orders.map((o) => o.id === id ? { ...o, status } : o); emit();
    const { error } = await supabase.from("orders").update({ status: statusIn(status) as any }).eq("id", id);
    if (error) console.error(error);
  },
  forUser(userId: string) { return db.orders.filter((o) => o.userId === userId); },
  delivered(userId: string) { return db.orders.filter((o) => o.userId === userId && o.status === "Delivered"); },
};

// ---------- Admin ----------
async function refreshAfter<T extends keyof DB>(_k?: T) { await loadPublicData(); await loadUserScopedData(); emit(); }

export const admin = {
  async saveProduct(p: Product) {
    const row = productToRow(p);
    const { error } = p.id
      ? await supabase.from("products").update(row).eq("id", p.id)
      : await supabase.from("products").insert(row);
    if (error) throw new Error(error.message);
    await loadPublicData(); emit();
  },
  async deleteProduct(id: string) {
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) throw new Error(error.message);
    db.products = db.products.filter((x) => x.id !== id); emit();
  },
  async saveCategory(c: Category) {
    const row: any = { name: c.name, slug: c.slug || c.name.toLowerCase().replace(/\s+/g, "-"), icon: c.icon ?? null };
    if (c.id) row.id = c.id;
    const { error } = c.id
      ? await supabase.from("categories").update(row).eq("id", c.id)
      : await supabase.from("categories").insert(row);
    if (error) throw new Error(error.message);
    await loadPublicData(); emit();
  },
  async deleteCategory(id: string) {
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) throw new Error(error.message);
    db.categories = db.categories.filter((c) => c.id !== id); emit();
  },
  async saveTags(tags: string[]) {
    const existing = db.tags;
    const toAdd = tags.filter((t) => !existing.includes(t));
    const toRemove = existing.filter((t) => !tags.includes(t));
    if (toAdd.length) { const { error } = await supabase.from("tags").insert(toAdd.map((name) => ({ name }))); if (error) throw new Error(error.message); }
    if (toRemove.length) { const { error } = await supabase.from("tags").delete().in("name", toRemove); if (error) throw new Error(error.message); }
    db.tags = tags; emit();
  },
  async saveCoupon(c: Coupon) {
    const row: any = {
      code: c.code, type: c.type, value: c.value,
      expires_at: c.expiresAt ? new Date(c.expiresAt).toISOString() : null,
      usage_limit: c.usageLimit ?? null, used_count: c.usedCount,
    };
    const { error } = await supabase.from("coupons").upsert(row, { onConflict: "code" });
    if (error) throw new Error(error.message);
    await loadPublicData(); emit();
  },
  async deleteCoupon(code: string) {
    const { error } = await supabase.from("coupons").delete().eq("code", code);
    if (error) throw new Error(error.message);
    db.coupons = db.coupons.filter((c) => c.code !== code); emit();
  },
  async saveReview(r: Review) {
    const row: any = { product_id: r.productId, user_id: r.userId, user_name: r.userName,
      rating: r.rating, text: r.text, approved: r.approved };
    const { error } = r.id
      ? await supabase.from("reviews").update(row).eq("id", r.id)
      : await supabase.from("reviews").insert(row);
    if (error) throw new Error(error.message);
    await loadPublicData(); emit();
  },
  async deleteReview(id: string) {
    await supabase.from("reviews").delete().eq("id", id);
    db.reviews = db.reviews.filter((r) => r.id !== id); emit();
  },
  async saveBlog(p: BlogPost) {
    const row: any = {
      slug: p.slug || p.title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
      title: p.title, excerpt: p.excerpt, content: p.content, cover: p.cover, author: p.author,
      published_at: new Date(p.publishedAt || Date.now()).toISOString(),
    };
    const { error } = p.id
      ? await supabase.from("blog_posts").update(row).eq("id", p.id)
      : await supabase.from("blog_posts").insert(row);
    if (error) throw new Error(error.message);
    await loadPublicData(); emit();
  },
  async deleteBlog(id: string) {
    const { error } = await supabase.from("blog_posts").delete().eq("id", id);
    if (error) throw new Error(error.message);
    db.blog = db.blog.filter((b) => b.id !== id); emit();
  },
  async saveTestimonial(t: Testimonial) {
    const row: any = { name: t.name, role: t.role, text: t.text, avatar: t.avatar ?? null, rating: t.rating };
    const { error } = t.id
      ? await supabase.from("testimonials").update(row).eq("id", t.id)
      : await supabase.from("testimonials").insert(row);
    if (error) throw new Error(error.message);
    await loadPublicData(); emit();
  },
  async deleteTestimonial(id: string) {
    const { error } = await supabase.from("testimonials").delete().eq("id", id);
    if (error) throw new Error(error.message);
    db.testimonials = db.testimonials.filter((t) => t.id !== id); emit();
  },
  async saveFaq(f: FAQ) {
    const row: any = { question: f.question, answer: f.answer };
    const { error } = f.id
      ? await supabase.from("faqs").update(row).eq("id", f.id)
      : await supabase.from("faqs").insert(row);
    if (error) throw new Error(error.message);
    await loadPublicData(); emit();
  },
  async deleteFaq(id: string) {
    const { error } = await supabase.from("faqs").delete().eq("id", id);
    if (error) throw new Error(error.message);
    db.faqs = db.faqs.filter((f) => f.id !== id); emit();
  },
  async savePages(p: Pages) {
    const rows = (Object.keys(p) as (keyof Pages)[]).map((slug) => ({ slug, title: slug, content: p[slug] }));
    const { error } = await supabase.from("pages").upsert(rows, { onConflict: "slug" });
    if (error) throw new Error(error.message);
    db.pages = { ...p }; emit();
  },
  async saveUser(_u: User) { /* admin user editing not supported via client */ },
  async deleteUser(_id: string) { /* requires service role */ },
  async setUserStatus(id: string, s: UserStatus) {
    const { error } = await supabase.from("profiles").update({ status: s }).eq("id", id);
    if (error) throw new Error(error.message);
    db.users = db.users.map((u) => u.id === id ? { ...u, status: s } : u); emit();
  },
  async saveSettings(s: Settings) {
    settingsSavePending = true;
    const { error } = await supabase.from("settings").update({
      brand: s.brand as any, hero: s.hero as any, integrations: s.integrations as any, payments: s.payments as any,
    }).eq("id", "singleton");
    if (error) { settingsSavePending = false; throw new Error(error.message); }
    db.settings = s; emit();
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
    setTimeout(() => { settingsSavePending = false; }, 1000);
  },
  async markMessageRead(id: string, read = true) {
    const { error } = await supabase.from("contact_messages").update({ read }).eq("id", id);
    if (error) throw new Error(error.message);
    db.contactMessages = db.contactMessages.map((m) => m.id === id ? { ...m, read } : m); emit();
  },
  async deleteMessage(id: string) {
    const { error } = await supabase.from("contact_messages").delete().eq("id", id);
    if (error) throw new Error(error.message);
    db.contactMessages = db.contactMessages.filter((m) => m.id !== id); emit();
  },
};

export async function submitContactMessage(name: string, email: string, message: string) {
  const { error } = await supabase.from("contact_messages").insert({ name, email, message });
  if (error) throw new Error(error.message);
}

export async function addReview(productId: string, rating: number, text: string) {
  const u = auth.current(); if (!u) throw new Error("Login to review");
  const { error } = await supabase.from("reviews").insert({
    product_id: productId, user_id: u.id, user_name: u.name, rating, text,
  });
  if (error) throw new Error(error.message);
  await loadPublicData(); emit();
}

export function resetStore() { /* no-op: data is in the database */ }

// ---------- Cart Drawer ----------
let drawerOpen = false;
const drawerListeners = new Set<() => void>();
export const cartDrawer = {
  open() { drawerOpen = true; drawerListeners.forEach((l) => l()); },
  close() { drawerOpen = false; drawerListeners.forEach((l) => l()); },
  set(v: boolean) { drawerOpen = v; drawerListeners.forEach((l) => l()); },
};
export function useCartDrawer(): [boolean, (v: boolean) => void] {
  const o = useSyncExternalStoreWithSelector(
    (fn) => { drawerListeners.add(fn); return () => { drawerListeners.delete(fn); }; },
    () => drawerOpen, () => false, (s) => s, Object.is,
  );
  return [o, cartDrawer.set];
}
