import { useCallback, useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Notif = {
	id?: number;
	type?: string;
	title?: string;
	message?: string;
	keyName?: string;
	keyId?: number;
	createdAt?: string;
	actionable?: boolean;
	expired?: boolean;
	challengeId?: number | null;
	token?: string | null;
	ideDetected?: string | null;
	[key: string]: unknown;
};

function notifTitle(n: Notif): string {
	if (n.title) return String(n.title);
	const t = String(n.type || "notification").replace(/_/g, " ");
	return t.charAt(0).toUpperCase() + t.slice(1);
}

function notifBody(n: Notif): string {
	const msg = String(n.message || "").trim();
	if (!msg) return notifTitle(n);
	const lines = msg.split("\n").filter(Boolean);
	if (lines.length <= 4) return msg;
	return lines.slice(0, 4).join("\n") + "\n…";
}

export default function NotificationBell({
	initialCount = 0,
	onChanged,
}: {
	initialCount?: number;
	onChanged?: () => void;
}) {
	const { t, lang } = useI18n();
	const [open, setOpen] = useState(false);
	const [items, setItems] = useState<Notif[]>([]);
	const [count, setCount] = useState(initialCount);
	const [loading, setLoading] = useState(false);
	const [dismissing, setDismissing] = useState(false);
	const [actingId, setActingId] = useState<number | null>(null);

	useEffect(() => {
		setCount(initialCount);
	}, [initialCount]);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const res = await api.notifications.list();
			const list = Array.isArray(res?.notifications) ? res.notifications : [];
			setItems(list);
			const actionable = list.filter((n) => n.actionable).length;
			setCount(actionable > 0 ? actionable : list.filter((n) => !n.readAt).length || list.length);
		} catch {
			setItems([]);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (open) void load();
	}, [open, load]);

	const dismissAll = async () => {
		setDismissing(true);
		try {
			await api.notifications.dismiss();
			setItems((prev) => prev.map((n) => ({ ...n, readAt: new Date().toISOString() })));
			setCount(0);
			onChanged?.();
			setOpen(false);
		} catch {
			/* ignore */
		} finally {
			setDismissing(false);
		}
	};

	const actChallenge = async (n: Notif, kind: "approve" | "deny") => {
		if (!n.challengeId || !n.token) return;
		setActingId(n.challengeId);
		try {
			if (kind === "approve") {
				await api.deviceChallenge.approve(n.challengeId, n.token);
			} else {
				await api.deviceChallenge.deny(n.challengeId, n.token);
			}
			await load();
			onChanged?.();
		} catch {
			/* ignore */
		} finally {
			setActingId(null);
		}
	};

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="relative p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
				aria-label={t("Notifications")}
			>
				<Bell className="w-5 h-5" />
				{count > 0 && (
					<span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-[10px] font-semibold text-primary-foreground flex items-center justify-center">
						{count > 9 ? "9+" : count}
					</span>
				)}
			</button>

			{open && (
				<div className="fixed inset-0 z-[70] flex items-start justify-end p-3 sm:p-6">
					<div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
					<div className="relative w-full max-w-md mt-12 sm:mt-14 mr-0 sm:mr-2 bg-card border border-border rounded-xl shadow-xl overflow-hidden animate-slide-up">
						<div className="flex items-center justify-between px-4 py-3 border-b border-border">
							<div className="flex items-center gap-2">
								<Bell className="w-4 h-4 text-primary" />
								<h2 className="text-sm font-semibold text-foreground">{t("Notifications")}</h2>
								{count > 0 && (
									<span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary">
										{count}
									</span>
								)}
							</div>
							<button
								type="button"
								onClick={() => setOpen(false)}
								className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent"
								aria-label="Close"
							>
								<X className="w-4 h-4" />
							</button>
						</div>

						<div className="max-h-[60vh] overflow-y-auto">
							{loading ? (
								<div className="p-6 text-sm text-muted-foreground text-center">{t("Loading...")}</div>
							) : items.length === 0 ? (
								<div className="p-8 text-sm text-muted-foreground text-center">
									{t("No notifications")}
								</div>
							) : (
								<ul className="divide-y divide-border/60">
									{items.map((n, i) => {
										const isDevice = n.type === "device_confirm";
										const disabled = !!n.expired || !n.actionable;
										return (
											<li
												key={`${n.id || 0}-${n.type || "n"}-${i}`}
												className={`px-4 py-3 space-y-2 ${disabled && isDevice ? "opacity-60" : ""}`}
											>
												<div className="flex items-center justify-between gap-2">
													<div className="text-sm font-medium text-foreground">{notifTitle(n)}</div>
													{isDevice && n.expired && (
														<span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
															{lang === "id" ? "Kedaluwarsa" : "Expired"}
														</span>
													)}
													{isDevice && n.actionable && (
														<span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600">
															{lang === "id" ? "Perlu aksi" : "Action needed"}
														</span>
													)}
												</div>
												{n.keyName && (
													<div className="text-[10px] text-muted-foreground font-mono">{String(n.keyName)}</div>
												)}
												<pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words font-sans">
													{notifBody(n)}
												</pre>
												{isDevice && n.challengeId && n.token && (
													<div className="flex gap-2 pt-1">
														<button
															type="button"
															disabled={disabled || actingId === n.challengeId}
															onClick={() => void actChallenge(n, "deny")}
															className="text-xs px-2.5 py-1.5 rounded-lg border border-border hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
														>
															{lang === "id" ? "Bukan saya" : "Not me"}
														</button>
														<button
															type="button"
															disabled={disabled || actingId === n.challengeId}
															onClick={() => void actChallenge(n, "approve")}
															className="text-xs px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
														>
															{lang === "id" ? "Ya itu saya" : "Yes, it's me"}
														</button>
													</div>
												)}
											</li>
										);
									})}
								</ul>
							)}
						</div>

						{items.length > 0 && (
							<div className="px-4 py-3 border-t border-border flex justify-end">
								<button
									type="button"
									onClick={dismissAll}
									disabled={dismissing}
									className="text-sm px-3 py-1.5 rounded-lg bg-accent hover:bg-accent/80 text-foreground disabled:opacity-50"
								>
									{dismissing ? "…" : t("Mark all read")}
								</button>
							</div>
						)}
					</div>
				</div>
			)}
		</>
	);
}
