import { useCallback, useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Notif = {
	type?: string;
	title?: string;
	message?: string;
	keyName?: string;
	keyId?: number;
	createdAt?: string;
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
	// Keep modal readable — strip huge credential dumps to first lines
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
	const { t } = useI18n();
	const [open, setOpen] = useState(false);
	const [items, setItems] = useState<Notif[]>([]);
	const [count, setCount] = useState(initialCount);
	const [loading, setLoading] = useState(false);
	const [dismissing, setDismissing] = useState(false);

	useEffect(() => {
		setCount(initialCount);
	}, [initialCount]);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const res = await api.notifications.list();
			const list = Array.isArray(res?.notifications) ? res.notifications : [];
			setItems(list);
			setCount(list.length);
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
			setItems([]);
			setCount(0);
			onChanged?.();
			setOpen(false);
		} catch {
			/* ignore */
		} finally {
			setDismissing(false);
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
									{items.map((n, i) => (
										<li key={`${n.keyId || 0}-${n.type || "n"}-${i}`} className="px-4 py-3 space-y-1">
											<div className="text-sm font-medium text-foreground">{notifTitle(n)}</div>
											{n.keyName && (
												<div className="text-[10px] text-muted-foreground font-mono">{String(n.keyName)}</div>
											)}
											<pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words font-sans">
												{notifBody(n)}
											</pre>
										</li>
									))}
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
