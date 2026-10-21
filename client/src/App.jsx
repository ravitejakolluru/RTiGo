import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowDownLeft, ArrowDownRight, ArrowUpRight, BadgeCheck,
  CalendarDays, Check, ChevronDown, CircleHelp, Clock3, CreditCard, Download,
  FileText, Filter, Globe2, LayoutDashboard, LoaderCircle, LockKeyhole,
  LogOut, Menu, MoreHorizontal, Pencil, Plus, Search, Settings2, ShieldCheck, Sparkles, Trash2,
  Wallet, X,
} from "lucide-react";
import { Button } from "./components/ui/button.jsx";
import { LocaleContext, currencyLocale, formatDate, formatINR, languages, transactionTypeLabel, translate, useLocale } from "./i18n.js";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

const api = async (path, options = {}) => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetch(`/api${path}`, {
      credentials: "include",
      ...options,
      signal: controller.signal,
      headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
    });
    const type = response.headers.get("content-type") || "";
    if (!response.ok) {
      const data = type.includes("application/json") ? await response.json() : null;
      const error = new Error(data?.error || (response.status >= 500
        ? "The API server is unavailable. Check its startup logs and database configuration."
        : "Something went wrong. Please try again."));
      error.status = response.status;
      throw error;
    }
    return type.includes("application/json") ? await response.json() : await response.blob();
  } catch (error) {
    if (error.status) throw error;
    if (error.name === "AbortError") {
      throw new Error("The request timed out. Please check your connection and try again.");
    }
    throw new Error("Could not reach the API. Check that the backend is running and the database is configured.");
  } finally {
    window.clearTimeout(timeout);
  }
};

const money = (value, language = "en", compact = false) => formatINR(value, language, compact);
const dateOnly = (value) => new Date(value).toISOString().slice(0, 10);
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
const firstDay = `${today.slice(0, 8)}01`;
const navItems = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "transactions", label: "Transactions", icon: ArrowDownLeft },
  { id: "payments", label: "Upcoming payments", icon: CalendarDays },
  { id: "reports", label: "Reports & sharing", icon: FileText },
];

function App() {
  const [language, setLanguageState] = useState(() => {
    const stored = window.localStorage.getItem("fund-manager-language");
    return languages.some((item) => item.code === stored) ? stored : "en";
  });
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [page, setPage] = useState("overview");
  const [period, setPeriod] = useState("month");
  const [range, setRange] = useState({ from: firstDay, to: today });
  const [dashboard, setDashboard] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [shares, setShares] = useState([]);
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [modal, setModal] = useState(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [publicReport, setPublicReport] = useState(null);
  const publicToken = window.location.pathname.match(/^\/share\/([^/]+)$/)?.[1];
  const setLanguage = (next) => {
    if (!languages.some((item) => item.code === next)) return;
    window.localStorage.setItem("fund-manager-language", next);
    setLanguageState(next);
  };
  const locale = {
    language,
    setLanguage,
    t: (text) => translate(text, language),
    money: (value, compact = false) => money(value, language, compact),
  };

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    if (publicToken) {
      api(`/public/${encodeURIComponent(publicToken)}`)
        .then(setPublicReport)
        .catch((e) => setError(e.message));
      return;
    }
    api("/auth/me").then((data) => setUser(data.user)).catch(() => {}).finally(() => setAuthChecked(true));
  }, [publicToken]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError("");
    try {
      const [dash, txs, due, acct, links] = await Promise.all([
        api(`/dashboard?from=${range.from}&to=${range.to}`),
        api("/transactions"),
        api("/schedules"),
        api("/account"),
        api("/shares"),
      ]);
      setDashboard(dash);
      setTransactions(txs.transactions);
      setSchedules(due.schedules);
      setAccount(acct.account);
      setLanguage(acct.account.language || "en");
      setShares(links.shares);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [user, range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  const choosePeriod = (value) => {
    setPeriod(value);
    const now = new Date();
    if (value === "day") setRange({ from: today, to: today });
    if (value === "month") setRange({ from: `${today.slice(0, 8)}01`, to: today });
    if (value === "year") setRange({ from: `${now.getFullYear()}-01-01`, to: today });
  };

  const doLogout = async () => {
    try { await api("/auth/logout", { method: "POST" }); } catch (e) { setError(e.message); }
    setUser(null);
    setDashboard(null);
  };

  if (publicToken) return <LocaleContext.Provider value={locale}><PublicPage report={publicReport} error={error} /></LocaleContext.Provider>;
  if (!authChecked) return <LocaleContext.Provider value={locale}><div className="loading-screen"><LoaderCircle className="spin" /> {translate("Loading your account…", language)}<BrandFooter /></div></LocaleContext.Provider>;
  if (!user) return <LocaleContext.Provider value={locale}><AuthScreen onLogin={setUser} /></LocaleContext.Provider>;

  const onNavigate = (next) => {
    setPage(next);
    setMobileMenu(false);
    setError("");
  };

  return (
    <LocaleContext.Provider value={locale}><div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><Activity size={19} strokeWidth={2.5} /></div>
          <span className="brand-copy"><b>RTIGO</b><small>Track Today. Grow Tomorrow.</small></span>
          <button className="icon-button sidebar-close" aria-label="Close menu" onClick={() => setMobileMenu(false)}><X size={18} /></button>
        </div>
        <div className="workspace-label">{locale.t("YOUR WORKSPACE")}</div>
        <div className="workspace-card">
          <div className="workspace-icon"><Wallet size={17} /></div>
          <div className="workspace-name"><b>{account?.name || locale.t("Personal funds")}</b><span>{locale.t("Personal account")}</span></div>
          <ChevronDown size={15} className="muted-icon" />
        </div>
        <div className="nav-label">{locale.t("MENU")}</div>
        <nav className="main-nav">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${page === id ? "active" : ""}`} onClick={() => onNavigate(id)}>
              <Icon size={18} strokeWidth={1.8} /><span>{locale.t(label)}</span>
              {id === "payments" && schedules.filter((s) => s.status === "scheduled").length > 0
                && <span className="nav-count">{schedules.filter((s) => s.status === "scheduled").length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="secure-note"><ShieldCheck size={17} /><span>{locale.t("Your finances stay private.")}<br />{locale.t("Always encrypted.")}</span></div>
          <button className={`nav-item ${page === "settings" ? "active" : ""}`} onClick={() => onNavigate("settings")}><Settings2 size={18} /><span>{locale.t("Account settings")}</span></button>
          <button className="nav-item logout-button" onClick={doLogout}><LogOut size={18} /><span>{locale.t("Sign out")}</span></button>
          <div className="profile-row"><div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div><div className="profile-info"><b>{user.name}</b><span>{user.email}</span></div><MoreHorizontal size={18} className="muted-icon" /></div>
        </div>
      </aside>
      {mobileMenu && <button className="mobile-backdrop" onClick={() => setMobileMenu(false)} aria-label="Close navigation" />}
      <main className="main-content">
        <header className="topbar">
          <button className="icon-button mobile-menu-button" aria-label="Open menu" onClick={() => setMobileMenu(true)}><Menu size={20} /></button>
          <div className="breadcrumb">{locale.t("Workspace")} <span>/</span> <b>{locale.t(navItems.find((n) => n.id === page)?.label || "Account settings")}</b></div>
          <div className="top-actions"><span className="secure-pill"><span /> {locale.t("All data encrypted")}</span><button className="help-button" title={locale.t("Help")}><CircleHelp size={18} /></button></div>
        </header>
        <div className="page-wrap">
          {error && <div className="error-banner" role="alert">{locale.t(error)}<button className="icon-button" onClick={() => setError("")}><X size={16} /></button></div>}
          {page === "overview" && <Dashboard dashboard={dashboard} period={period} onPeriod={choosePeriod} range={range} setRange={(r) => { setPeriod("custom"); setRange(r); }} loading={loading} setModal={setModal} onNavigate={onNavigate} />}
          {page === "transactions" && <Transactions rows={transactions} loading={loading} setModal={setModal} reload={load} setError={setError} />}
          {page === "payments" && <Payments rows={schedules} loading={loading} setModal={setModal} reload={load} setError={setError} />}
          {page === "reports" && <Reports shares={shares} range={range} setRange={setRange} reload={load} setError={setError} />}
          {page === "settings" && <Settings account={account} reload={load} setError={setError} />}
        </div>
        <BrandFooter />
      </main>
      {modal && <TransactionModal mode={modal} close={() => setModal(null)} reload={load} setError={setError} />}
    </div></LocaleContext.Provider>
  );
}

function AuthScreen({ onLogin }) {
  const { t } = useLocale();
  const [mode, setMode] = useState("login");
  const [values, setValues] = useState({ name: "", email: "", password: "", code: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const set = (key) => (event) => setValues((v) => ({ ...v, [key]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      if (mode === "register") {
        await api("/auth/register", { method: "POST", body: JSON.stringify(values) });
        setMessage(t("Verification code sent. Check your inbox, then enter the code below."));
        setMode("verify");
      } else if (mode === "verify") {
        const result = await api("/auth/verify-email", { method: "POST", body: JSON.stringify(values) });
        onLogin(result.user);
      } else if (mode === "forgot") {
        const result = await api("/auth/forgot-password", { method: "POST", body: JSON.stringify(values) });
        setMessage(result.message);
        setMode("reset");
      } else if (mode === "reset") {
        const result = await api("/auth/reset-password", { method: "POST", body: JSON.stringify(values) });
        setMessage(result.message);
        setMode("login");
      } else {
        const result = await api("/auth/login", { method: "POST", body: JSON.stringify(values) });
        onLogin(result.user);
      }
    } catch (e) {
      if (mode === "login" && e.status === 403) {
        setMode("verify");
        setMessage(t(e.message));
      } else {
        setError(t(e.message));
      }
    } finally { setBusy(false); }
  };
  const resendVerification = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api("/auth/resend-verification", { method: "POST", body: JSON.stringify({ email: values.email }) });
      setMessage(result.message);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const title = t({ login: "Welcome back", register: "Create your account", verify: "Check your inbox", forgot: "Reset your password", reset: "Choose a new password" }[mode]);
  return (
    <div className="auth-page">
      <div className="auth-decoration auth-decoration-one" /><div className="auth-decoration auth-decoration-two" />
      <div className="auth-card">
        <div className="brand auth-brand"><div className="brand-mark"><Activity size={19} strokeWidth={2.5} /></div><span className="brand-copy"><b>RTIGO</b><small>Track Today. Grow Tomorrow.</small></span></div>
        <div className="auth-kicker"><Sparkles size={14} /> {t("YOUR MONEY, IN FOCUS")}</div>
        <h1>{title}</h1>
        <p className="auth-subtitle">{t("A calmer, clearer way to manage your personal finances.")}</p>
        {error && <div className="auth-error" role="alert">{t(error)}</div>}
        {message && <div className="auth-message">{t(message)}</div>}
        <form onSubmit={submit} className="auth-form">
          {mode === "register" && <Field label={t("Full name")} value={values.name} onChange={set("name")} placeholder="Alex Morgan" required />}
          {mode !== "verify" && <Field label={t("Email address")} value={values.email} onChange={set("email")} placeholder="you@example.com" type="email" required />}
          {mode === "verify" && <Field label={t("6-digit verification code")} value={values.code} onChange={set("code")} placeholder="000000" required />}
          {mode === "reset" && <Field label={t("Reset code")} value={values.code} onChange={set("code")} placeholder="000000" required />}
          {["login", "register", "reset"].includes(mode) && <Field label={t("Password")} value={values.password} onChange={set("password")} placeholder={t(mode === "login" ? "Enter your password" : "At least 10 characters")} type="password" required minLength={mode === "login" ? undefined : 10} />}
          {mode === "login" && <button type="button" className="text-link forgot-link" onClick={() => setMode("forgot")}>{t("Forgot password?")}</button>}
          <Button className="primary-button auth-submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : null}{t(mode === "login" ? "Sign in" : mode === "register" ? "Create account" : mode === "verify" ? "Verify email" : mode === "forgot" ? "Send reset code" : "Update password")}<ArrowUpRight size={16} /></Button>
        </form>
        {mode === "verify" && <button type="button" className="text-link resend-link" onClick={resendVerification} disabled={busy}>{t("Resend verification code")}</button>}
        <div className="auth-switch">{t(mode === "login" ? "New to RTIGO?" : "Already have an account?")}<button className="text-link" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); setMessage(""); }}>{t(mode === "login" ? "Create an account" : "Sign in")}</button></div>
        <div className="auth-foot"><LockKeyhole size={13} /> {t("Protected with secure, private sessions")}</div>
      </div>
      <BrandFooter />
    </div>
  );
}

function Dashboard({ dashboard, period, onPeriod, range, setRange, loading, setModal, onNavigate }) {
  const { t, money, language } = useLocale();
  const summary = dashboard?.summary;
  const periods = [["day", "Daily"], ["month", "Monthly"], ["year", "Yearly"], ["custom", "Custom"]];
  return (
    <div className="page-enter">
      <div className="page-heading">
        <div><div className="eyebrow"><span className="live-dot" /> {t("YOUR FINANCIAL OVERVIEW")}</div><h1>{t("Good morning")}<span className="heading-period">.</span></h1><p>{t("Here’s what’s happening with your money today.")}</p></div>
        <div className="heading-actions"><button className="secondary-button" onClick={() => onNavigate("reports")}><FileText size={16} /> {t("Statement")}</button><button className="primary-button" onClick={() => setModal("income")}><Plus size={17} /> {t("Add transaction")}</button></div>
      </div>
      <div className="period-bar">
        <div className="period-tabs">{periods.map(([id, label]) => <button key={id} className={period === id ? "selected" : ""} onClick={() => id === "custom" ? onPeriod("custom") : onPeriod(id)}>{t(label)}</button>)}</div>
        {period === "custom" ? <div className="date-filter"><input aria-label={t("From")} type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /><span>{t("to")}</span><input aria-label={t("To")} type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></div> : <div className="period-caption"><CalendarDays size={14} /> {period === "day" ? t("Today") : period === "year" ? new Date().getFullYear() : new Date().toLocaleDateString(currencyLocale(language), { month: "long", year: "numeric" })}<ChevronDown size={14} /></div>}
      </div>
      {loading && !dashboard ? <div className="inline-loading"><LoaderCircle className="spin" /> {t("Loading your financial picture…")}</div> : <>
        <section className="summary-grid">
          <article className="balance-card">
            <div className="balance-top"><span className="balance-label">{t("TOTAL BALANCE")}</span><span className="balance-icon"><Wallet size={18} /></span></div>
            <div className="balance-amount">{money(summary?.current)}</div>
            <div className="balance-foot"><span><span className="balance-status-dot" /> {t("Looking good")}</span><span>{t("Across your account")}</span></div>
            <div className="balance-orb" />
          </article>
          <Metric label="Total income" value={summary?.periodIncome} kind="income" note="For selected period" />
          <Metric label="Paid expenditure" value={summary?.periodExpense} kind="expense" note="For selected period" />
          <Metric label="Upcoming payments" value={summary?.upcoming} kind="upcoming" note="Scheduled commitments" />
        </section>
        <section className="content-grid">
          <article className="panel chart-panel">
            <div className="panel-heading"><div><h2>{t("Cash flow")}</h2><p>{t("Income vs. expenditure")}</p></div><button className="small-select">{t(period === "day" ? "Daily" : period === "year" ? "Yearly" : "This month")}<ChevronDown size={14} /></button></div>
            <div className="chart-legend"><span><i className="legend-income" /> {t("Income")}</span><span><i className="legend-expense" /> {t("Expenditure")}</span></div>
            <div className="chart-wrap">{dashboard?.chart?.length ? <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dashboard.chart} margin={{ top: 8, right: 6, left: -18, bottom: 0 }}>
                <defs><linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b7cff" stopOpacity={0.28} /><stop offset="100%" stopColor="#8b7cff" stopOpacity={0} /></linearGradient><linearGradient id="expenseFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#55a5ff" stopOpacity={0.2} /><stop offset="100%" stopColor="#55a5ff" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid stroke="#302d49" vertical={false} strokeDasharray="3 5" />
                <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fill: "#aaa5c1", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(value) => money(value, true)} tick={{ fill: "#aaa5c1", fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "#19172e", border: "1px solid #393552", borderRadius: 10, color: "#f0edff" }} formatter={(value) => money(value)} labelFormatter={formatDate} />
                <Area type="monotone" dataKey="income" stroke="#a99cff" strokeWidth={2} fill="url(#incomeFill)" />
                <Area type="monotone" dataKey="expense" stroke="#72b5ff" strokeWidth={2} fill="url(#expenseFill)" />
              </AreaChart>
            </ResponsiveContainer> : <EmptyState icon={Activity} title="Your cash flow will show here" message="Add a transaction to start tracking your activity." />}</div>
            <div className="chart-footer"><span><span className="chart-foot-dot" /> {t("Your cash flow is up to date")}</span><button className="text-link" onClick={() => onNavigate("transactions")}>{t("View transactions")} <ArrowUpRight size={14} /></button></div>
          </article>
          <article className="panel balance-breakdown">
            <div className="panel-heading"><div><h2>{t("Balance overview")}</h2><p>{t("Your money at a glance")}</p></div><button className="icon-button" aria-label={t("More options")}><MoreHorizontal size={18} /></button></div>
            <div className="breakdown-total"><span>{t("Available balance")}</span><b>{money(summary?.available)}</b></div>
            <div className="projected-balance"><span>{t("Projected after unpaid payments")}</span><b>{money(summary?.projected)}</b></div>
            <div className="breakdown-bar"><i /><i /><i /></div>
            <div className="breakdown-row"><span><i className="break-dot dot-opening" /> {t("Opening balance")}</span><b>{money(summary?.opening)}</b></div>
            <div className="breakdown-row"><span><i className="break-dot dot-income" /> {t("Total income")}</span><b className="positive">+{money(summary?.income)}</b></div>
            <div className="breakdown-row"><span><i className="break-dot dot-expense" /> {t("Paid expenditure")}</span><b className="negative">−{money(summary?.expense)}</b></div>
            <div className="breakdown-row"><span><i className="break-dot dot-withdraw" /> {t("Withdrawals")}</span><b className="negative">−{money(summary?.withdrawal)}</b></div>
            <div className="breakdown-note"><ShieldCheck size={15} /><span>{t("Unpaid scheduled expenses are kept separate from your available balance.")}</span></div>
          </article>
        </section>
        <section className="panel recent-panel">
          <div className="panel-heading"><div><h2>{t("Recent transactions")}</h2><p>{t("Your latest account activity")}</p></div><button className="secondary-button small-button" onClick={() => onNavigate("transactions")}>{t("View all")} <ArrowUpRight size={14} /></button></div>
          <TransactionTable rows={dashboard?.transactions || []} compact />
        </section>
        <div className="dashboard-bottom"><div className="bottom-note"><div className="note-icon"><ShieldCheck size={18} /></div><div><b>{t("Private by design")}</b><span>{t("Your financial data belongs to you. Share only what you choose.")}</span></div><button className="text-link" onClick={() => onNavigate("reports")}>{t("Manage sharing")} <ArrowUpRight size={14} /></button></div><button className="quick-add" onClick={() => setModal("expense")}><div><Plus size={18} /></div><span><b>{t("Log an expense")}</b><small>{t("Keep your records current")}</small></span><ArrowUpRight size={16} /></button></div>
      </>}
    </div>
  );
}

function Metric({ label, value, kind, note }) {
  const { t, money } = useLocale();
  const icons = { income: ArrowDownLeft, expense: ArrowUpRight, upcoming: Clock3 };
  const Icon = icons[kind];
  return <article className="metric-card"><div className="metric-top"><span>{t(label)}</span><span className={`metric-icon ${kind}`}><Icon size={17} /></span></div><b>{money(value)}</b><span className="metric-note">{t(note)}</span><div className={`metric-spark ${kind}`}><span /><span /><span /><span /><span /><span /><span /><span /><span /><span /></div></article>;
}

function Transactions({ rows, loading, setModal, reload, setError }) {
  const { t } = useLocale();
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => rows.filter((row) => (filter === "all" || row.kind === filter)
    && `${row.title} ${row.category || ""} ${row.counterparty || ""}`.toLowerCase().includes(query.toLowerCase())), [rows, filter, query]);
  return <div className="page-enter">
    <div className="page-heading"><div><div className="eyebrow">{t("YOUR MONEY, MOVING")}</div><h1>{t("Transactions")}<span className="heading-period">.</span></h1><p>{t("A complete record of what comes in and goes out.")}</p></div><button className="primary-button" onClick={() => setModal("income")}><Plus size={17} /> {t("Add transaction")}</button></div>
    <div className="table-toolbar"><div className="filter-tabs">{["all", "income", "expense", "withdrawal"].map((item) => <button key={item} className={filter === item ? "selected" : ""} onClick={() => setFilter(item)}>{t(item === "all" ? "All activity" : item[0].toUpperCase() + item.slice(1))}</button>)}</div><label className="search-box"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search transactions")} /><Filter size={15} /></label></div>
    <section className="panel table-panel"><div className="table-title"><div><h2>{t("All transactions")}</h2><span>{filtered.length} {t("records")}</span></div><button className="icon-button" title={t("More filters")}><MoreHorizontal size={18} /></button></div>{loading ? <div className="inline-loading"><LoaderCircle className="spin" /> {t("Loading transactions…")}</div> : <TransactionTable rows={filtered} onEdit={(row) => setModal({ type: "edit", transaction: row })} onDelete={async (row) => { if (!window.confirm(t("Remove this transaction from your balance? The audit history will be retained."))) return; try { await api(`/transactions/${row.id}`, { method: "DELETE" }); await reload(); } catch (e) { setError(e.message); } }} />}</section>
  </div>;
}

function TransactionTable({ rows, compact = false, onEdit, onDelete }) {
  const { t, money, language } = useLocale();
  if (!rows.length) return <EmptyState icon={CreditCard} title="No transactions yet" message="When you add income or expenses, they’ll appear here." />;
  return <div className="table-scroll"><table><thead><tr><th>{t("TRANSACTION")}</th><th>{t("CATEGORY")}</th><th>{t("DATE")}</th><th>{t("STATUS")}</th><th className="align-right">{t("AMOUNT")}</th>{onEdit && <th className="align-right">{t("ACTIONS")}</th>}</tr></thead><tbody>{rows.map((row) => {
    const positive = row.kind === "income";
    const Icon = positive ? ArrowDownLeft : row.kind === "withdrawal" ? ArrowDownRight : ArrowUpRight;
    return <tr key={row.id}><td><div className="transaction-name"><span className={`tx-icon ${row.kind}`}><Icon size={16} /></span><span><b>{row.title}</b><small>{row.counterparty || row.category || t(row.kind === "income" ? "Received" : "Paid")}</small></span></div></td><td><span className="category-pill">{row.category || t(transactionTypeLabel(row.kind))}</span></td><td>{formatDate(row.happenedAt)}</td><td><span className={`status-pill ${row.status}`}>{row.status === "posted" ? <Check size={12} /> : <Clock3 size={12} />}{t(row.status)}</span></td><td className={`amount-cell ${positive ? "positive" : ""}`}>{positive ? "+" : "−"}{money(row.amount)}</td>{onEdit && <td><div className="row-actions"><button className="icon-button" aria-label={`${t("Edit")} ${row.title}`} title={t("Edit")} onClick={() => onEdit(row)}><Pencil size={14} /></button><button className="icon-button row-delete" aria-label={`${t("Delete")} ${row.title}`} title={t("Delete")} onClick={() => onDelete(row)}><Trash2 size={14} /></button></div></td>}</tr>;
  })}</tbody></table></div>;
}

function Payments({ rows, loading, setModal, reload, setError }) {
  const { t, money, language } = useLocale();
  const [view, setView] = useState("month");
  const calendarRows = rows.filter((row) => {
    const due = dateOnly(row.dueDate);
    if (due < today) return true;
    if (view === "day") return due === today;
    if (view === "year") return due.slice(0, 4) === today.slice(0, 4);
    return due.slice(0, 7) === today.slice(0, 7);
  });
  const change = async (row) => {
    try { await api(`/schedules/${row.id}`, { method: "PATCH", body: JSON.stringify({ status: "paid", happenedAt: today }) }); await reload(); }
    catch (e) { setError(e.message); }
  };
  const remove = async (row) => {
    try { await api(`/schedules/${row.id}`, { method: "DELETE" }); await reload(); }
    catch (e) { setError(e.message); }
  };
  const outstanding = rows.filter((item) => item.status === "scheduled");
  const overdue = outstanding.filter((item) => dateOnly(item.dueDate) < today).length;
  return <div className="page-enter">
    <div className="page-heading"><div><div className="eyebrow">{t("STAY A STEP AHEAD")}</div><h1>{t("Upcoming payments")}<span className="heading-period">.</span></h1><p>{t("Plan for what’s due. Your scheduled payments won’t change your balance until paid.")}</p></div><button className="primary-button" onClick={() => setModal("schedule")}><Plus size={17} /> {t("Schedule payment")}</button></div>
    <div className="payment-summary"><div className="payment-summary-card"><span>{t("Scheduled commitments")}</span><b>{money(outstanding.reduce((sum, item) => sum + Number(item.amount), 0))}</b><small>{outstanding.length} {t("unpaid payments")}</small></div><div className="payment-summary-card"><span>{t("Overdue")}</span><b className={overdue ? "negative" : ""}>{overdue}</b><small>{t(overdue ? "Needs your attention" : "You’re all caught up")}</small></div><div className="calendar-view-switch">{["day", "month", "year"].map((item) => <button className={view === item ? "selected" : ""} onClick={() => setView(item)} key={item}>{t(item)}</button>)}</div></div>
    <section className="panel table-panel"><div className="table-title"><div><h2>{t("Payment schedule")}</h2><span>{t(view === "day" ? "Due today" : view === "year" ? "Due in" : "Due this month")} {view === "year" ? new Date().getFullYear() : ""}</span></div><span className="calendar-month"><CalendarDays size={15} /> {new Date().toLocaleDateString(currencyLocale(language), { month: "long", year: "numeric" })}</span></div>
      {loading ? <div className="inline-loading"><LoaderCircle className="spin" /> {t("Loading payments…")}</div> : calendarRows.length ? <div className="payment-list">{calendarRows.map((row) => {
        const isOverdue = row.status === "scheduled" && dateOnly(row.dueDate) < today;
        return <div className="payment-row" key={row.id}><div className={`payment-date ${isOverdue ? "overdue" : ""}`}><b>{formatDate(row.dueDate)}</b></div><div className="payment-info"><b>{row.name}</b><span>{row.recipient || t("No recipient")}{row.category ? ` · ${row.category}` : ""}</span></div>{isOverdue && <span className="overdue-label">{t("Overdue")}</span>}<b className="payment-amount">{money(row.amount)}</b>{row.status === "scheduled" ? <div className="payment-actions"><button className="secondary-button small-button" onClick={() => change(row)}><Check size={14} /> {t("Mark paid")}</button><button className="icon-button" aria-label={t("Delete scheduled payment")} onClick={() => remove(row)}><X size={15} /></button></div> : <span className="status-pill posted"><Check size={12} /> {t("paid")}</span>}</div>;
      })}</div> : <EmptyState icon={CalendarDays} title="Nothing due in this view" message="Try another calendar range or schedule a payment for this period." />}</section>
  </div>;
}

function Reports({ shares, range, setRange, reload, setError }) {
  const { t, language } = useLocale();
  const [fields, setFields] = useState(["date", "kind", "title", "amount", "incomeTotal", "expenseTotal", "availableBalance"]);
  const [expires, setExpires] = useState("");
  const [createdUrl, setCreatedUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const choices = [["date", "Date"], ["kind", "Type"], ["title", "Description"], ["amount", "Amount"], ["counterparty", "Paid to / from"], ["category", "Category"], ["incomeTotal", "Amount received"], ["expenseTotal", "Amount spent"], ["availableBalance", "Available balance now"]];
  const createShare = async (event) => {
    event.preventDefault(); setBusy(true); setError(""); setCreatedUrl("");
    try {
      const result = await api("/shares", { method: "POST", body: JSON.stringify({ from: range.from, to: range.to, fields, expiresAt: expires || null }) });
      setCreatedUrl(result.url); await reload();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const revoke = async (id) => {
    try { await api(`/shares/${id}`, { method: "DELETE" }); await reload(); }
    catch (e) { setError(e.message); }
  };
  const download = async (type) => {
    try {
      const blob = await api(`/statements.pdf?from=${range.from}&to=${range.to}&type=${type}`);
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `statement-${range.from}-${range.to}.pdf`; anchor.click(); URL.revokeObjectURL(url);
    } catch (e) { setError(e.message); }
  };
  return <div className="page-enter">
    <div className="page-heading"><div><div className="eyebrow">{t("YOUR DATA, YOUR WAY")}</div><h1>{t("Reports & sharing")}<span className="heading-period">.</span></h1><p>{t("Download a reconciled statement or share a carefully scoped report.")}</p></div></div>
    <div className="reports-grid">
      <section className="panel report-card"><div className="report-icon"><FileText size={20} /></div><h2>{t("Download a statement")}</h2><p>{t("Get a chronological PDF statement with opening and closing balances for your selected period.")}</p><div className="report-controls"><label>{t("From")}<input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label><label>{t("To")}<input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label></div><label className="select-label">{t("Include transactions")}<select id="statement-type"><option value="all">{t("All transactions")}</option><option value="income">{t("Income only")}</option><option value="expense">{t("Paid expenditure only")}</option><option value="withdrawal">{t("Withdrawals only")}</option></select></label><button className="primary-button full-button" onClick={() => download(document.querySelector("#statement-type")?.value || "all")}><Download size={16} /> {t("Download PDF statement")}</button></section>
      <section className="panel report-card share-create-card"><div className="report-icon share"><Globe2 size={20} /></div><h2>{t("Create a public report")}</h2><p>{t("Read-only and private by default. Only the records and fields you select will be visible.")}</p><p className="share-local-warning">{t("To share outside this computer, deploy the site and set APP_ORIGIN to its public HTTPS address.")}</p><form onSubmit={createShare}><div className="report-controls"><label>{t("From")}<input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} required /></label><label>{t("To")}<input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} required /></label></div><div className="fields-label">{t("VISIBLE FIELDS")}</div><div className="field-options">{choices.map(([id, label]) => <label key={id}><input type="checkbox" checked={fields.includes(id)} onChange={(e) => setFields(e.target.checked ? [...fields, id] : fields.filter((f) => f !== id))} /><span className="custom-check">{fields.includes(id) && <Check size={12} />}</span>{t(label)}</label>)}</div><label className="select-label">{t("Optional expiry")}<input type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} /></label><button className="primary-button full-button" disabled={busy || !fields.length}><Globe2 size={16} /> {t("Create read-only link")}</button></form>{createdUrl && <div className="created-link"><BadgeCheck size={16} /><span>{t("Link created")}</span><a href={createdUrl} target="_blank" rel="noreferrer">{t("Open report")} <ArrowUpRight size={13} /></a><button title={t("Copy")} onClick={() => navigator.clipboard.writeText(createdUrl)}>{t("Copy")}</button></div>}</section>
    </div>
    <section className="panel monthly-report-note">
      <CalendarDays size={18} />
      <div><b>{t("Monthly email reports")}</b><p>{t("Sent to your registered email on the 1st of each month for the previous full month, with next month’s unpaid bills and a fresh PDF password in the same email.")}</p></div>
    </section>
    <section className="panel table-panel share-management"><div className="table-title"><div><h2>{t("Manage share links")}</h2><span>{t("Revoke access at any time")}</span></div><span className="share-count">{shares.filter((share) => !share.revokedAt && (!share.expiresAt || new Date(share.expiresAt) > new Date())).length} {t("active")}</span></div>
    {shares.length ? <div className="shares-list">{shares.map((share) => { const inactive = share.revokedAt || (share.expiresAt && new Date(share.expiresAt) <= new Date()); return <div className="share-row" key={share.id}><div className={`share-row-icon ${inactive ? "inactive" : ""}`}><Globe2 size={17} /></div><div className="share-row-info"><b>{formatDate(share.fromDate)} — {formatDate(share.toDate)}</b><span>{share.fields.map((field) => t(choices.find(([key]) => key === field)?.[1] || field)).join(", ")} · {t("created")} {formatDate(share.createdAt)}</span></div><span className={`status-pill ${inactive ? "scheduled" : "posted"}`}>{t(share.revokedAt ? "revoked" : share.expiresAt && new Date(share.expiresAt) <= new Date() ? "expired" : "active")}</span>{!inactive && <button className="text-link revoke-button" onClick={() => revoke(share.id)}>{t("Revoke link")}</button>}</div>; })}</div> : <EmptyState icon={Globe2} title="No shared reports" message="Create a link when you’re ready to share a limited view." />}</section>
  </div>;
}

function Settings({ account, reload, setError }) {
  const { t, language, setLanguage } = useLocale();
  const [name, setName] = useState(account?.name || "");
  const [openingBalance, setOpeningBalance] = useState(account?.openingBalance || "0.00");
  const [allowOverdraft, setAllowOverdraft] = useState(account?.allowOverdraft || false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (account) { setName(account.name); setOpeningBalance(account.openingBalance); setAllowOverdraft(account.allowOverdraft); } }, [account]);
  const submit = async (event) => {
    event.preventDefault(); setSaved(false);
    try { await api("/account", { method: "PATCH", body: JSON.stringify({ name, openingBalance, allowOverdraft }) }); setSaved(true); await reload(); }
    catch (e) { setError(e.message); }
  };
  const updateLanguage = async (next) => {
    setSaved(false);
    try {
      await api("/account", { method: "PATCH", body: JSON.stringify({ language: next }) });
      setLanguage(next);
      setSaved(true);
    } catch (e) { setError(e.message); }
  };
  return <div className="page-enter"><div className="page-heading"><div><div className="eyebrow">{t("PREFERENCES & SECURITY")}</div><h1>{t("Account settings")}<span className="heading-period">.</span></h1><p>{t("Manage your account details and balance policy.")}</p></div></div><section className="panel settings-panel"><div className="settings-section-heading"><div className="report-icon"><Settings2 size={19} /></div><div><h2>{t("Financial account")}</h2><p>{t("These settings apply to your personal account.")}</p></div></div><form onSubmit={submit} className="settings-form"><Field label="Account name" value={name} onChange={(e) => setName(e.target.value)} required /><Field label="Opening balance" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} type="number" min="0" step="0.01" required /><label className="field language-field"><span>{t("Language")}</span><select value={language} onChange={(e) => updateLanguage(e.target.value)}>{languages.map((item) => <option key={item.code} value={item.code}>{item.nativeName}</option>)}</select><small>{t("Choose your preferred display language.")}</small></label><label className="overdraft-setting"><span><b>{t("Allow overdraft")}</b><small>{t("Permit posted transactions to take your balance below zero.")}</small></span><input type="checkbox" checked={allowOverdraft} onChange={(e) => setAllowOverdraft(e.target.checked)} /></label><div className="settings-footer">{saved && <span className="saved-label"><Check size={15} /> {t("Changes saved")}</span>}<button className="primary-button"><Check size={16} /> {t("Save settings")}</button></div></form></section></div>;
}

function TransactionModal({ mode, close, reload, setError }) {
  const { t } = useLocale();
  const transaction = typeof mode === "object" ? mode.transaction : null;
  const isEdit = Boolean(transaction);
  const isSchedule = mode === "schedule";
  const [kind, setKind] = useState(transaction?.kind || (mode === "withdrawal" ? "withdrawal" : mode === "expense" ? "expense" : "income"));
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    amount: transaction?.amount || "", title: transaction?.title || "", counterparty: transaction?.counterparty || "",
    category: transaction?.category || "", happenedAt: transaction ? dateOnly(transaction.happenedAt) : today,
    dueDate: today, method: transaction?.method || "", notes: transaction?.notes || "", status: transaction?.status || "posted",
  });
  const change = (key) => (event) => setForm((value) => ({ ...value, [key]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault(); setBusy(true);
    try {
      const isIncome = !isSchedule && kind === "income";
      const transactionData = isIncome
        ? { amount: form.amount, title: transaction?.title || "Income", counterparty: form.counterparty, category: form.category, happenedAt: form.happenedAt, kind, status: "posted" }
        : { ...form, kind, happenedAt: form.happenedAt };
      if (isEdit) await api(`/transactions/${transaction.id}`, { method: "PATCH", body: JSON.stringify(transactionData) });
      else if (isSchedule) await api("/schedules", { method: "POST", body: JSON.stringify({ ...form, name: form.title, dueDate: form.dueDate, recipient: form.counterparty }) });
      else await api("/transactions", { method: "POST", body: JSON.stringify(transactionData) });
      await reload(); close();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const isIncome = !isSchedule && kind === "income";
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><div><div className="eyebrow">{t(isSchedule ? "PLAN AHEAD" : isEdit ? "UPDATE RECORD" : "RECORD ACTIVITY")}</div><h2 id="modal-title">{t(isSchedule ? "Schedule a payment" : isEdit ? "Edit transaction" : "Add a transaction")}</h2></div><button className="icon-button" onClick={close} aria-label={t("Close")}><X size={19} /></button></div>
    {!isSchedule && <div className="transaction-type-picker">{["income", "expense", "withdrawal"].map((type) => <button key={type} type="button" className={kind === type ? "selected" : ""} onClick={() => setKind(type)}>{type === "income" ? <ArrowDownLeft size={15} /> : type === "expense" ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}{t(type[0].toUpperCase() + type.slice(1))}</button>)}</div>}
    <form className="modal-form" onSubmit={submit}><Field label="Amount" value={form.amount} onChange={change("amount")} type="number" min="0.01" step="0.01" placeholder="0.00" required />
      {isIncome ? <>
        <Field label="Date" value={form.happenedAt} onChange={change("happenedAt")} type="date" required />
        <Field label="Application app" value={form.category} onChange={change("category")} placeholder="e.g. PhonePe, Paytm, Google Pay" required />
        <Field label="Received From (Self/person)" value={form.counterparty} onChange={change("counterparty")} placeholder="Self or person name" required />
      </> : <>
        <Field label={isSchedule ? "Payment name" : "Reason / description"} value={form.title} onChange={change("title")} placeholder={isSchedule ? "Monthly rent" : "What was this for?"} required />
        <Field label={isSchedule ? "Recipient" : kind === "withdrawal" ? "Withdrawn by" : "Paid to"} value={form.counterparty} onChange={change("counterparty")} placeholder="Name or organization" />
        <Field label={isSchedule ? "Due date" : "Date"} value={isSchedule ? form.dueDate : form.happenedAt} onChange={change(isSchedule ? "dueDate" : "happenedAt")} type="date" required />
        <Field label={isSchedule ? "Category" : kind === "withdrawal" ? "Destination" : "Application"} value={form.category} onChange={change("category")} placeholder={kind === "withdrawal" ? "Cash, another account…" : "e.g. PhonePe, Paytm, Google Pay"} />
      </>}
      {!isSchedule && kind === "expense" && <label className="field"><span>{t("Payment status")}</span><select value={form.status} onChange={change("status")}><option value="posted">{t("Paid")}</option><option value="scheduled">{t("Unpaid / scheduled")}</option></select></label>}
      {!isIncome && <label className="field full-field"><span>{t("Notes")} <small>{t("Optional")}</small></span><textarea value={form.notes} onChange={change("notes")} placeholder={t("Add a note…")} rows="2" /></label>}
      <div className="modal-footer"><button type="button" className="secondary-button" onClick={close}>{t("Cancel")}</button><button className="primary-button" disabled={busy}>{busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{t(isSchedule ? "Add to schedule" : isEdit ? "Save changes" : "Save transaction")}</button></div>
    </form>
  </section></div>;
}

function Field({ label, value, onChange, type = "text", placeholder, required, minLength, min, step }) {
  const { t } = useLocale();
  return <label className="field"><span>{t(label)}</span><input type={type} value={value} onChange={onChange} placeholder={placeholder ? t(placeholder) : undefined} required={required} minLength={minLength} min={min} step={step} /></label>;
}

function PublicPage({ report, error }) {
  const { t, money } = useLocale();
  if (error || (!report && !error)) return <div className="public-page"><div className="public-state"><div className="brand-mark"><ShieldCheck size={20} /></div><h1>{t(error ? "Report unavailable" : "Loading report…")}</h1><p>{t(error || "Please wait while we securely load this report.")}</p></div><BrandFooter /></div>;
  const summaries = [
    ["incomeTotal", "Amount received"],
    ["expenseTotal", "Amount spent"],
    ["availableBalance", "Available balance now"],
  ].filter(([key]) => Object.hasOwn(report.summary || {}, key));
  return (
    <div className="public-page">
      <header className="public-header">
        <div className="brand"><div className="brand-mark"><Activity size={19} /></div><span className="brand-copy"><b>RTIGO</b><small>Track Today. Grow Tomorrow.</small></span></div>
        <span className="secure-pill"><LockKeyhole size={13} /> {t("Read-only report")}</span>
      </header>
      <main className="public-main">
        <div className="eyebrow"><Globe2 size={14} /> {t("SHARED FINANCIAL REPORT")}</div>
        <h1>{t("A little more clarity")}<span className="heading-period">.</span></h1>
        <p className="public-description">{t("A private, read-only view of selected records.")}</p>
        <div className="public-period"><CalendarDays size={16} /> {formatDate(report.from)} — {formatDate(report.to)}</div>
        {summaries.length > 0 && <section className="public-summary-grid" aria-label={t("Financial summary")}>
          {summaries.map(([key, label]) => <article className="public-summary-card" key={key}>
            <span>{t(label)}</span><b>{money(report.summary[key])}</b>
            {key !== "availableBalance" && <small>{t("For selected period")}</small>}
          </article>)}
        </section>}
        <section className="panel public-table">
          {report.records.length ? <div className="table-scroll"><table>
            <thead><tr>{report.fields.map((field) => <th key={field}>{t(({ date: "DATE", kind: "Type", title: "Description", amount: "AMOUNT", counterparty: "Paid to / from", category: "CATEGORY" })[field])}</th>)}</tr></thead>
            <tbody>{report.records.map((record, index) => <tr key={index}>{report.fields.map((field) => <td key={field}>
              {field === "amount" ? <span className={`public-transaction-amount ${({ income: "credit", expense: "debit", withdrawal: "withdraw" })[record.kind] || ""}`}>{money(record[field])}</span>
                : field === "kind" ? <span className={`public-transaction-type ${({ income: "credit", expense: "debit", withdrawal: "withdraw" })[record[field]] || ""}`}>{t(transactionTypeLabel(record[field]))}</span>
                  : field === "date" ? formatDate(record[field]) : record[field]}
            </td>)}</tr>)}</tbody>
          </table></div> : <EmptyState icon={FileText} title="No records in this period" message="There are no transactions to show for the selected dates." />}
        </section>
        <div className="public-foot"><ShieldCheck size={15} /> {t("This report only shows the fields its owner selected. No account access is available.")}</div>
      </main>
      <BrandFooter />
    </div>
  );
}

function BrandFooter() {
  return (
    <footer className="brand-footer">
      <span>Developed By <b>Raviteja Kolluru</b></span>
      <span><b>RTIGO</b>: R = Rupees · T = Track · I = Insights · GO = Growth &amp; Organization</span>
    </footer>
  );
}

function EmptyState({ icon: Icon, title, message }) {
  const { t } = useLocale();
  return <div className="empty-state"><div className="empty-icon"><Icon size={19} /></div><b>{t(title)}</b><span>{t(message)}</span></div>;
}

export default App;
