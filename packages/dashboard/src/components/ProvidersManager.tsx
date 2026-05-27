import { useState, useEffect } from "react";
import { request } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash, Plus, Edit } from "lucide-react";

export function ProvidersManager() {
  const [providers, setProviders] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [priority, setPriority] = useState(1);

  const loadProviders = async () => {
    try {
      const res = await request<any[]>("/providers");
      setProviders(res);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadProviders();
  }, []);

  const handleAdd = async () => {
    try {
      await request("/providers", {
        method: "POST",
        body: JSON.stringify({ name, endpoint, apiKey, priority }),
      });
      setName(""); setEndpoint(""); setApiKey(""); setPriority(1);
      loadProviders();
    } catch (e: any) {
      alert("Error: " + e.message);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("Delete provider?")) return;
    try {
      await request(`/providers/${id}`, { method: "DELETE" });
      loadProviders();
    } catch (e: any) {
      alert("Error: " + e.message);
    }
  };

  return (
    <Card className="border-border/50 mt-6">
      <CardHeader>
        <CardTitle className="text-base">Upstream Providers</CardTitle>
        <CardDescription>Configure multiple upstream APIs. Models will be fetched from all active providers.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-5 gap-2 border-b border-border/50 pb-2 mb-2 text-sm font-medium text-muted-foreground">
            <div className="col-span-1">Name</div>
            <div className="col-span-2">Endpoint</div>
            <div className="col-span-1">Priority</div>
            <div className="col-span-1 text-right">Actions</div>
          </div>
          {providers.map((p) => (
            <div key={p.id} className="grid grid-cols-5 gap-2 items-center border-b border-border/50 pb-2">
              <div className="col-span-1 truncate">{p.name}</div>
              <div className="col-span-2 truncate">{p.endpoint}</div>
              <div className="col-span-1">{p.priority}</div>
              <div className="col-span-1 text-right flex justify-end gap-1">
                <Button
                  variant={p.isActive ? "default" : "outline"}
                  size="sm"
                  onClick={async () => {
                    await request(`/providers/${p.id}`, {
                      method: "PUT",
                      body: JSON.stringify({ isActive: !p.isActive }),
                    });
                    loadProviders();
                  }}
                >
                  {p.isActive ? "On" : "Off"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleDelete(p.id)}>
                  <Trash className="w-4 h-4 text-red-500" />
                </Button>
              </div>
            </div>
          ))}
          <div className="grid grid-cols-5 gap-2 mt-4 items-end">
            <div className="col-span-1">
              <Label>Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="OpenAI" />
            </div>
            <div className="col-span-2">
              <Label>Endpoint URL</Label>
              <Input value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="https://api.openai.com/v1" />
            </div>
            <div className="col-span-1">
              <Label>Priority</Label>
              <Input type="number" value={priority} onChange={e => setPriority(parseInt(e.target.value)||0)} />
            </div>
          </div>
          <div className="mt-2">
            <Label>API Key</Label>
            <div className="flex gap-2">
              <Input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." type="password" />
              <Button onClick={handleAdd} disabled={!name || !endpoint || !apiKey}>
                <Plus className="w-4 h-4 mr-2" /> Add
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}