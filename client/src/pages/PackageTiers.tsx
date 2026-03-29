import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Package, Plus, Edit, Trash2, Loader2 } from "lucide-react";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function PackageTiers() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingTier, setEditingTier] = useState<any>(null);
  const [formData, setFormData] = useState({
    name: "",
    maxQueries: 5,
    maxLocations: 3,
    monthlyPrice: 0,
    description: "",
  });

  const { data: tiers, isLoading } = trpc.packageTier.list.useQuery();
  const utils = trpc.useUtils();

  const createMutation = trpc.packageTier.create.useMutation({
    onSuccess: () => {
      toast.success("Package tier created");
      utils.packageTier.list.invalidate();
      setIsCreateOpen(false);
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = trpc.packageTier.update.useMutation({
    onSuccess: () => {
      toast.success("Package tier updated");
      utils.packageTier.list.invalidate();
      setEditingTier(null);
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.packageTier.delete.useMutation({
    onSuccess: () => {
      toast.success("Package tier deleted");
      utils.packageTier.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const resetForm = () => {
    setFormData({ name: "", maxQueries: 5, maxLocations: 3, monthlyPrice: 0, description: "" });
  };

  const handleSubmit = () => {
    if (editingTier) {
      updateMutation.mutate({ id: editingTier.id, ...formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const openEdit = (tier: any) => {
    setEditingTier(tier);
    setFormData({
      name: tier.name,
      maxQueries: tier.maxQueries,
      maxLocations: tier.maxLocations,
      monthlyPrice: tier.monthlyPrice,
      description: tier.description || "",
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const TierForm = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Package Name</Label>
        <Input
          placeholder="e.g., Starter, Growth, Pro, Enterprise"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Max Search Queries</Label>
          <Input
            type="number"
            min={1}
            max={50}
            value={formData.maxQueries}
            onChange={(e) => setFormData({ ...formData, maxQueries: parseInt(e.target.value) || 1 })}
          />
        </div>
        <div className="space-y-2">
          <Label>Max Locations</Label>
          <Input
            type="number"
            min={1}
            max={50}
            value={formData.maxLocations}
            onChange={(e) => setFormData({ ...formData, maxLocations: parseInt(e.target.value) || 1 })}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Monthly Price ($)</Label>
        <Input
          type="number"
          min={0}
          step={1}
          value={formData.monthlyPrice}
          onChange={(e) => setFormData({ ...formData, monthlyPrice: parseInt(e.target.value) || 0 })}
        />
      </div>
      <div className="space-y-2">
        <Label>Description (optional)</Label>
        <Input
          placeholder="Brief description of this package"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
        />
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground" style={{ fontFamily: "var(--font-heading)" }}>
            Package Tiers
          </h1>
          <p className="text-muted-foreground mt-1">
            Define service packages that control campaign scope
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={(open) => { setIsCreateOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Package
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Package Tier</DialogTitle>
              <DialogDescription>
                Define the number of search queries and locations included in this package.
              </DialogDescription>
            </DialogHeader>
            <TierForm />
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={!formData.name || createMutation.isPending}>
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editingTier} onOpenChange={(open) => { if (!open) { setEditingTier(null); resetForm(); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Package Tier</DialogTitle>
            <DialogDescription>Update the package configuration.</DialogDescription>
          </DialogHeader>
          <TierForm />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditingTier(null); resetForm(); }}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={!formData.name || updateMutation.isPending}>
              {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Package Grid */}
      {tiers && tiers.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tiers.map((tier: any) => (
            <Card key={tier.id} className="bg-card border-border relative group">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{tier.name}</CardTitle>
                    {tier.description && (
                      <CardDescription className="mt-1">{tier.description}</CardDescription>
                    )}
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(tier)}>
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => {
                        if (confirm("Delete this package tier?")) {
                          deleteMutation.mutate({ id: tier.id });
                        }
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-bold text-foreground">${tier.monthlyPrice}</span>
                    <span className="text-sm text-muted-foreground">/month</span>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant="secondary">{tier.maxQueries} queries</Badge>
                    <Badge variant="secondary">{tier.maxLocations} locations</Badge>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {tier.maxQueries * tier.maxLocations} total training combinations
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="bg-card border-border">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Package className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">No packages defined</h3>
            <p className="text-sm text-muted-foreground max-w-md mb-6">
              Create package tiers to define how many search queries and locations each
              client gets based on their subscription level.
            </p>
            <Button onClick={() => setIsCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create First Package
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
