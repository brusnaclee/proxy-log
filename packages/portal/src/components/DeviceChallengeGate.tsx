import { useCallback, useEffect, useState } from "react";
import { ShieldAlert, X } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type Challenge = {
	id: number;
	token: string;
	ideDetected?: string | null;
	expiresAt?: string;
	fingerprint?: string;
};

/**
 * Auto-popup when a pending device confirmation exists (not expired).
 */
export default function DeviceChallengeGate({
	onResolved,
}: {
	onResolved?: () => void;
}) {
	const { lang } = useI18n();
	const [challenge, setChallenge] = useState<Challenge | null>(null);
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState<string | null>(null);

	const load = useCallback(async () => {
		try {
			const res = await api.notifications.list();
			const pending = (res.pendingChallenges || []).filter((c: any) => {
				if (!c?.expiresAt) return true;
				return new Date(c.expiresAt).getTime() > Date.now();
			});
			const first = pending[0];
			if (first?.id && first?.token) {
				setChallenge({
					id: first.id,
					token: first.token,
					ideDetected: first.ideDetected,
					expiresAt: first.expiresAt,
					fingerprint: first.fingerprint,
				});
			} else {
				setChallenge(null);
			}
		} catch {
			setChallenge(null);
		}
	}, []);

	useEffect(() => {
		void load();
		const tmr = setInterval(() => void load(), 30_000);
		return () => clearInterval(tmr);
	}, [load]);

	if (!challenge) return null;

	const act = async (kind: "approve" | "deny") => {
		setBusy(true);
		setMsg(null);
		try {
			const res =
				kind === "approve"
					? await api.deviceChallenge.approve(challenge.id, challenge.token)
					: await api.deviceChallenge.deny(challenge.id, challenge.token);
			setMsg(
				kind === "approve"
					? lang === "id"
						? "Device dikonfirmasi. Slot tertua diganti."
						: "Device confirmed. Oldest slot replaced."
					: (res as any)?.blacklisted
						? lang === "id"
							? "Ditolak dan di-blacklist."
							: "Denied and blacklisted."
						: lang === "id"
							? "Device ditolak."
							: "Device denied.",
			);
			setTimeout(() => {
				setChallenge(null);
				onResolved?.();
			}, 1200);
		} catch (e: any) {
			setMsg(e?.message || "Failed");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
			<div className="absolute inset-0 bg-black/60" />
			<div className="relative w-full max-w-md bg-card border border-border rounded-xl shadow-2xl p-5 space-y-4 animate-slide-up">
				<div className="flex items-start justify-between gap-3">
					<div className="flex items-center gap-2">
						<ShieldAlert className="w-5 h-5 text-amber-500" />
						<h2 className="text-base font-semibold text-foreground">
							{lang === "id" ? "Konfirmasi device baru" : "Confirm new device"}
						</h2>
					</div>
					<button
						type="button"
						className="p-1 rounded-lg text-muted-foreground hover:bg-accent"
						onClick={() => setChallenge(null)}
						aria-label="Close"
					>
						<X className="w-4 h-4" />
					</button>
				</div>
				<p className="text-sm text-muted-foreground">
					{lang === "id"
						? `IDE/client baru (${challenge.ideDetected || "Unknown"}) meminta akses. Slot penuh — konfirmasi dalam 30 menit.`
						: `New IDE/client (${challenge.ideDetected || "Unknown"}) wants access. Slots full — confirm within 30 minutes.`}
				</p>
				{challenge.expiresAt && (
					<p className="text-xs text-muted-foreground">
						Expires: {new Date(challenge.expiresAt).toLocaleString()}
					</p>
				)}
				{msg && <p className="text-sm text-foreground">{msg}</p>}
				<div className="flex gap-2 justify-end">
					<button
						type="button"
						disabled={busy}
						onClick={() => void act("deny")}
						className="px-3 py-2 text-sm rounded-lg border border-border hover:bg-accent disabled:opacity-50"
					>
						{lang === "id" ? "Bukan saya" : "Not me"}
					</button>
					<button
						type="button"
						disabled={busy}
						onClick={() => void act("approve")}
						className="px-3 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
					>
						{lang === "id" ? "Ya itu saya" : "Yes, it's me"}
					</button>
				</div>
			</div>
		</div>
	);
}
