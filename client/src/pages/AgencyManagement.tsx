import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Loader2, Plus, Building2, Mail, Phone, Pencil, Trash2,
  ChevronDown, ChevronRight, Users, CreditCard, CheckCircle, XCircle,
  Package
} from "lucide-react";

// Package tier is selected PER CLIENT when the agency adds a client — NOT at agency level.
// This constant is used only in the client list display.
const TIER_LABELS: Record<string, string> = {
  starter: "Starter",
  growth: "Growth",
  pro: "Pro",
};

const defaultForm = {
  name: "",
  contactEmail: "",
  contactName: "",
  phone: "",
  brandName: "",
  brandLogoUrl: "",
  brandFromName: "",
  notes: "",
  isActive: true,
};

export default function AgencyManagement() {
  const { data: agencies, isLoading } = trpc.agency.list.useQuery();
  const utils = trpc.useUtils();

  const createMutation = trpc.agency.create.useMutation({
    onSuccess: () => {
      toast.success("Agency created");
      utils.agency.list.invalidate();
      setIsDialogOpen(false);
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.agency.update.useMutation({
    onSuccess: () => {
      toast.success("Agency updated");
      utils.agency.list.invalidate();
      setIsDialogOpen(false);
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.agency.delete.useMutation({
    onSuccess: () => {
      toast.success("Agency deleted");
      utils.agency.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [formData, setFormData] = useState({ ...defaultForm });

  const resetForm = () => {
    setFormData({ ...defaultForm });
    setEditingId(null);
  };

  const openCreate = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  const openEdit = (agency: any) => {
    setFormData({
      name: agency.name || "",
      contactEmail: agency.contactEmail || "",
      contactName: agency.contactName || "",
      phone: agency.phone || "",
      brandName: agency.brandName || "",
      brandLogoUrl: agency.brandLogoUrl || "",
      brandFromName: agency.brandFromName || "",
      notes: agency.notes || "",
      isActive: agency.isActive ?? true,
    });
    setEditingId(agency.id);
    setIsDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formData.name.trim()) return toast.error("Agency name is required");
    if (!formData.contactEmail.trim()) return toast.error("Contact email is required");
    if (editingId !== null) {
      updateMutation.mutate({ id: editingId, ...formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDelete = (id: number, name: string) => {
    if (!confirm(`Delete agency "${name}"? This cannot be undone.`)) return;
    deleteMutation.mutate({ id });
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agency Management</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage white-label reseller agencies and their client portfolios.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Add Agency
        </Button>
      </div>

      {/* Agency List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !agencies?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Building2 className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="font-medium">No agencies yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Add your first reseller agency to get started.
            </p>
            <Button className="mt-4" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" /> Add Agency
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {agencies.map((agency: any) => (
            <Card key={agency.id} className="overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setExpandedId(expandedId === agency.id ? null : agency.id)}
                    >
                      {expandedId === agency.id
                        ? <ChevronDown className="h-4 w-4" />
                        : <ChevronRight className="h-4 w-4" />}
                    </button>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-base">{agency.name}</CardTitle>
                        <Badge variant={agency.isActive ? "default" : "secondary"}>
                          {agency.isActive ? "Active" : "Inactive"}
                        </Badge>
                        {agency.brandName && (
                          <Badge variant="outline" className="text-xs">
                            {agency.brandName}
                          </Badge>
                        )}
                      </div>
                      <CardDescription className="mt-1 flex items-center gap-3 flex-wrap">
                        <span className="flex items-center gap-1">
                          <Mail className="h-3 w-3" />{agency.contactEmail}
                        </span>
                        {agency.contactName && (
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" />{agency.contactName}
                          </span>
                        )}
                        {agency.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />{agency.phone}
                          </span>
                        )}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground" title="Payment method">
                      <CreditCard className="h-3 w-3" />
                      {agency.hasPaymentMethod
                        ? <CheckCircle className="h-3 w-3 text-green-500" />
                        : <XCircle className="h-3 w-3 text-muted-foreground" />}
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(agency)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDelete(agency.id, agency.name)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>

              {/* Expanded: clients for this agency */}
              {expandedId === agency.id && (
                <AgencyClients agencyId={agency.id} agencyName={agency.name} />
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          if (!open) { setIsDialogOpen(false); resetForm(); }
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId !== null ? "Edit Agency" : "Add Agency"}</DialogTitle>
            <DialogDescription>
              {editingId !== null
                ? "Update agency details."
                : "Create a new white-label reseller agency. Package tier is selected per client when you add them."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Core info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label>Agency Name *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Acme Digital Marketing"
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label>Contact Email *</Label>
                <Input
                  type="email"
                  value={formData.contactEmail}
                  onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                  placeholder="owner@acmedigital.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Contact Name</Label>
                <Input
                  value={formData.contactName}
                  onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                  placeholder="John Smith"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="(555) 555-5555"
                />
              </div>
            </div>

            {/* White-label branding */}
            <div className="border rounded-lg p-4 space-y-3">
              <p className="text-sm font-medium">White-Label Branding</p>
              <div className="space-y-1.5">
                <Label>Brand Name</Label>
                <Input
                  value={formData.brandName}
                  onChange={(e) => setFormData({ ...formData, brandName: e.target.value })}
                  placeholder="Acme AI Visibility"
                />
              </div>
              <div className="space-y-1.5">
                <Label>From Name (emails)</Label>
                <Input
                  value={formData.brandFromName}
                  onChange={(e) => setFormData({ ...formData, brandFromName: e.target.value })}
                  placeholder="Acme AI Team"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Logo URL</Label>
                <Input
                  value={formData.brandLogoUrl}
                  onChange={(e) => setFormData({ ...formData, brandLogoUrl: e.target.value })}
                  placeholder="https://acmedigital.com/logo.png"
                />
              </div>
            </div>

            {/* Status + Notes */}
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={formData.isActive ? "active" : "inactive"}
                onValueChange={(v) => setFormData({ ...formData, isActive: v === "active" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Internal Notes</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Any notes about this agency..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsDialogOpen(false); resetForm(); }}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isSaving}>
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingId !== null ? "Save Changes" : "Create Agency"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Inline sub-component: shows clients for a given agency */
function AgencyClients({ agencyId, agencyName }: { agencyId: number; agencyName: string }) {
  const { data: clients, isLoading } = trpc.agency.getClients.useQuery({ agencyId });

  if (isLoading) {
    return (
      <CardContent className="pt-0 pb-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground pl-7">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading clients…
        </div>
      </CardContent>
    );
  }

  if (!clients?.length) {
    return (
      <CardContent className="pt-0 pb-4">
        <p className="text-sm text-muted-foreground pl-7">
          No clients assigned to {agencyName} yet.
        </p>
      </CardContent>
    );
  }

  return (
    <CardContent className="pt-0 pb-4">
      <div className="pl-7 space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
          Clients ({clients.length})
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {clients.map((client: any) => (
            <div
              key={client.id}
              className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{client.name}</p>
                {client.location && (
                  <p className="text-xs text-muted-foreground truncate">{client.location}</p>
                )}
              </div>
              {client.agencyPackageTier && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                  <Package className="h-3 w-3" />
                  <span className="capitalize">{TIER_LABELS[client.agencyPackageTier] ?? client.agencyPackageTier}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </CardContent>
  );
}
