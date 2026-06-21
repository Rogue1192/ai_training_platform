import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Loader2, Plus, Building2, MapPin, Phone, Globe, Trash2, Pencil,
  Shield, Search, CheckSquare, Square, Archive, X,
} from "lucide-react";

export default function Businesses() {
  const { data: businesses, isLoading, refetch } = trpc.business.list.useQuery();
  const createBusiness = trpc.business.create.useMutation();
  const updateBusiness = trpc.business.update.useMutation();
  const deleteBusiness = trpc.business.delete.useMutation();
  const bulkDeleteMutation = trpc.business.bulkDelete.useMutation();
  const bulkArchiveMutation = trpc.business.bulkArchive.useMutation();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingBusiness, setEditingBusiness] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("basic");

  // Search & selection state
  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "rogue" | "ranklocal" | "whitelabel" | "direct">("all");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isBulkActionPending, setIsBulkActionPending] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    businessType: "",
    location: "",
    description: "",
    website: "",
    phone: "",
    address: "",
    notes: "",
    contactEmail: "",
    contactName: "",
    certifications: "",
    awards: "",
    yearsInBusiness: "",
    bbbRating: "",
    licenses: "",
    warranties: "",
    differentiators: "",
    clientType: "ai_only",
    siteAdminUrl: "",
    siteUsername: "",
    sitePassword: "",
    useWebhookForContent: false,
  });

  const resetForm = () => {
    setFormData({
      name: "",
      businessType: "",
      location: "",
      description: "",
      website: "",
      phone: "",
      address: "",
      notes: "",
      contactEmail: "",
      contactName: "",
      certifications: "",
      awards: "",
      yearsInBusiness: "",
      bbbRating: "",
      licenses: "",
      warranties: "",
      differentiators: "",
      clientType: "ai_only",
      siteAdminUrl: "",
      siteUsername: "",
      sitePassword: "",
      useWebhookForContent: false,
    });
    setEditingBusiness(null);
    setActiveTab("basic");
  };

  // Filtered businesses based on search query and source filter
  const filteredBusinesses = useMemo(() => {
    if (!businesses) return [];
    let result = businesses;

    // Source filter
    if (sourceFilter === "rogue") {
      result = result.filter((b) => (b as any).internalSource === "rogue");
    } else if (sourceFilter === "ranklocal") {
      result = result.filter((b) => (b as any).internalSource === "ranklocal");
    } else if (sourceFilter === "whitelabel") {
      result = result.filter((b) => (b as any).agencyId != null && !(b as any).internalSource);
    } else if (sourceFilter === "direct") {
      result = result.filter((b) => (b as any).agencyId == null && !(b as any).internalSource);
    }

    // Text search
    if (!searchQuery.trim()) return result;
    const q = searchQuery.toLowerCase();
    return result.filter(
      (b) =>
        b.name?.toLowerCase().includes(q) ||
        b.businessType?.toLowerCase().includes(q) ||
        b.location?.toLowerCase().includes(q) ||
        b.contactEmail?.toLowerCase().includes(q) ||
        b.website?.toLowerCase().includes(q)
    );
  }, [businesses, searchQuery, sourceFilter]);

  // Selection helpers
  const allFilteredSelected =
    filteredBusinesses.length > 0 &&
    filteredBusinesses.every((b) => selectedIds.has(b.id));
  const someSelected = selectedIds.size > 0;

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      // Deselect all filtered
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredBusinesses.forEach((b) => next.delete(b.id));
        return next;
      });
    } else {
      // Select all filtered
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredBusinesses.forEach((b) => next.add(b.id));
        return next;
      });
    }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleEdit = (business: any) => {
    setFormData({
      name: business.name || "",
      businessType: business.businessType || "",
      location: business.location || "",
      description: business.description || "",
      website: business.website || "",
      phone: business.phone || "",
      address: business.address || "",
      notes: business.notes || "",
      contactEmail: business.contactEmail || "",
      contactName: business.contactName || "",
      certifications: business.certifications || "",
      awards: business.awards || "",
      yearsInBusiness: business.yearsInBusiness ? business.yearsInBusiness.toString() : "",
      bbbRating: business.bbbRating || "",
      licenses: business.licenses || "",
      warranties: business.warranties || "",
      differentiators: business.differentiators || "",
      clientType: business.clientType || "ai_only",
      siteAdminUrl: business.siteAdminUrl || "",
      siteUsername: business.siteUsername || "",
      sitePassword: "",
      useWebhookForContent: business.useWebhookForContent ?? false,
    });
    setEditingBusiness(business.id);
    setActiveTab("basic");
    setIsDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error("Business name is required");
      return;
    }
    const payload: any = { ...formData };
    if (payload.yearsInBusiness) {
      payload.yearsInBusiness = parseInt(payload.yearsInBusiness, 10);
    } else {
      delete payload.yearsInBusiness;
    }
    if (!payload.sitePassword) delete payload.sitePassword;
    try {
      if (editingBusiness) {
        await updateBusiness.mutateAsync({ id: editingBusiness, ...payload });
        toast.success("Business updated successfully");
      } else {
        await createBusiness.mutateAsync(payload);
        toast.success("Business created successfully");
      }
      setIsDialogOpen(false);
      resetForm();
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Failed to save business");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this business?")) return;
    try {
      await deleteBusiness.mutateAsync({ id });
      toast.success("Business deleted successfully");
      setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Failed to delete business");
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} business${selectedIds.size > 1 ? "es" : ""}? This cannot be undone.`)) return;
    setIsBulkActionPending(true);
    try {
      await bulkDeleteMutation.mutateAsync({ ids: Array.from(selectedIds) });
      toast.success(`Deleted ${selectedIds.size} business${selectedIds.size > 1 ? "es" : ""}`);
      clearSelection();
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Bulk delete failed");
    } finally {
      setIsBulkActionPending(false);
    }
  };

  const handleBulkArchive = async () => {
    if (selectedIds.size === 0) return;
    setIsBulkActionPending(true);
    try {
      await bulkArchiveMutation.mutateAsync({ ids: Array.from(selectedIds) });
      toast.success(`Archived ${selectedIds.size} business${selectedIds.size > 1 ? "es" : ""}`);
      clearSelection();
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Bulk archive failed");
    } finally {
      setIsBulkActionPending(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Businesses</h1>
          <p className="text-muted-foreground mt-2">Manage target businesses for AI training</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Add Business
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-card border-border">
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle className="text-card-foreground">
                  {editingBusiness ? "Edit Business" : "Add New Business"}
                </DialogTitle>
                <DialogDescription>Enter the details of the target business for AI training</DialogDescription>
              </DialogHeader>

              <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="basic">Basic Info</TabsTrigger>
                  <TabsTrigger value="credibility">Credibility Data</TabsTrigger>
                  <TabsTrigger value="publishing">Publishing</TabsTrigger>
                </TabsList>

                <TabsContent value="basic" className="space-y-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Business Name *</Label>
                      <Input id="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g., Acme HVAC Services" required className="bg-background border-input" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="businessType">Business Type</Label>
                      <Input id="businessType" value={formData.businessType} onChange={(e) => setFormData({ ...formData, businessType: e.target.value })} placeholder="e.g., HVAC Company" className="bg-background border-input" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="location">Location</Label>
                      <Input id="location" value={formData.location} onChange={(e) => setFormData({ ...formData, location: e.target.value })} placeholder="e.g., Phoenix, AZ" className="bg-background border-input" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone">Phone</Label>
                      <Input id="phone" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} placeholder="e.g., (555) 123-4567" className="bg-background border-input" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="website">Website</Label>
                      <Input id="website" value={formData.website} onChange={(e) => setFormData({ ...formData, website: e.target.value })} placeholder="e.g., https://example.com" className="bg-background border-input" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="clientType">Client Type</Label>
                      <Select value={formData.clientType} onValueChange={(value) => setFormData({ ...formData, clientType: value })}>
                        <SelectTrigger className="bg-background border-input">
                          <SelectValue placeholder="Select client type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ai_only">AI Answer Forge Only</SelectItem>
                          <SelectItem value="ai_plus_seo">AI + SEO (Existing Site)</SelectItem>
                          <SelectItem value="ai_plus_seo_plus_build">AI + SEO + New Build</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="contactName">Contact Name</Label>
                      <Input id="contactName" value={formData.contactName} onChange={(e) => setFormData({ ...formData, contactName: e.target.value })} placeholder="e.g., John Smith" className="bg-background border-input" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="contactEmail">Contact Email</Label>
                      <Input id="contactEmail" type="email" value={formData.contactEmail} onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })} placeholder="e.g., john@example.com" className="bg-background border-input" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="address">Address</Label>
                    <Input id="address" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} placeholder="e.g., 123 Main St, Phoenix, AZ 85001" className="bg-background border-input" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea id="description" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Brief description of the business and services" rows={3} className="bg-background border-input" />
                  </div>
                </TabsContent>

                <TabsContent value="credibility" className="space-y-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="yearsInBusiness">Years in Business</Label>
                      <Input id="yearsInBusiness" type="number" value={formData.yearsInBusiness} onChange={(e) => setFormData({ ...formData, yearsInBusiness: e.target.value })} placeholder="e.g., 15" className="bg-background border-input" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bbbRating">BBB Rating</Label>
                      <Input id="bbbRating" value={formData.bbbRating} onChange={(e) => setFormData({ ...formData, bbbRating: e.target.value })} placeholder="e.g., A+" className="bg-background border-input" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="certifications">Certifications</Label>
                    <Input id="certifications" value={formData.certifications} onChange={(e) => setFormData({ ...formData, certifications: e.target.value })} placeholder="e.g., NATE Certified, EPA Certified" className="bg-background border-input" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="licenses">Licenses</Label>
                    <Input id="licenses" value={formData.licenses} onChange={(e) => setFormData({ ...formData, licenses: e.target.value })} placeholder="e.g., TX HVAC License #12345" className="bg-background border-input" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="awards">Awards</Label>
                    <Input id="awards" value={formData.awards} onChange={(e) => setFormData({ ...formData, awards: e.target.value })} placeholder="e.g., Best of Phoenix 2023" className="bg-background border-input" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="warranties">Warranties</Label>
                    <Input id="warranties" value={formData.warranties} onChange={(e) => setFormData({ ...formData, warranties: e.target.value })} placeholder="e.g., 10-year parts warranty" className="bg-background border-input" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="differentiators">Key Differentiators</Label>
                    <Textarea id="differentiators" value={formData.differentiators} onChange={(e) => setFormData({ ...formData, differentiators: e.target.value })} placeholder="What makes this business stand out?" rows={3} className="bg-background border-input" />
                  </div>
                </TabsContent>

                <TabsContent value="publishing" className="space-y-4 py-4">
                  <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-300">
                    WordPress auto-publishing is disabled. Your team will manually add credibility pages to the client site.
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="siteAdminUrl">WordPress Admin URL (optional reference)</Label>
                    <Input id="siteAdminUrl" value={formData.siteAdminUrl} onChange={(e) => setFormData({ ...formData, siteAdminUrl: e.target.value })} placeholder="https://example.com/wp-admin" className="bg-background border-input" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="siteUsername">Username</Label>
                      <Input id="siteUsername" value={formData.siteUsername} onChange={(e) => setFormData({ ...formData, siteUsername: e.target.value })} placeholder="admin" className="bg-background border-input" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="sitePassword">Password</Label>
                      <Input id="sitePassword" type="password" value={formData.sitePassword} onChange={(e) => setFormData({ ...formData, sitePassword: e.target.value })} placeholder="••••••••" className="bg-background border-input" />
                    </div>
                  </div>
                </TabsContent>
              </Tabs>

              <DialogFooter className="mt-6">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createBusiness.isPending || updateBusiness.isPending}>
                  {createBusiness.isPending || updateBusiness.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</>
                  ) : editingBusiness ? "Update Business" : "Create Business"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search + Source Filter */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9 bg-card border-border"
            placeholder="Search by name, type, location, email, or website…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setSearchQuery("")}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as any)}>
          <SelectTrigger className="w-48 bg-card border-border">
            <SelectValue placeholder="Filter by source" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Clients</SelectItem>
            <SelectItem value="rogue">Rogue Business Mktg</SelectItem>
            <SelectItem value="ranklocal">Rank Local</SelectItem>
            <SelectItem value="whitelabel">White-Label Agencies</SelectItem>
            <SelectItem value="direct">Direct (No Source)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Bulk action toolbar — shown when items are selected */}
      {someSelected && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-primary/10 border border-primary/30">
          <span className="text-sm font-medium text-primary">
            {selectedIds.size} selected
          </span>
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            onClick={clearSelection}
            className="h-8"
          >
            <X className="w-3.5 h-3.5 mr-1.5" />
            Clear
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleBulkArchive}
            disabled={isBulkActionPending}
            className="h-8"
          >
            {isBulkActionPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Archive className="w-3.5 h-3.5 mr-1.5" />}
            Archive
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleBulkDelete}
            disabled={isBulkActionPending}
            className="h-8"
          >
            {isBulkActionPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 mr-1.5" />}
            Delete
          </Button>
        </div>
      )}

      {/* Results count + select all */}
      {filteredBusinesses.length > 0 && (
        <div className="flex items-center gap-3">
          <button
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            onClick={toggleSelectAll}
          >
            {allFilteredSelected ? (
              <CheckSquare className="w-4 h-4 text-primary" />
            ) : (
              <Square className="w-4 h-4" />
            )}
            {allFilteredSelected ? "Deselect all" : "Select all"}
          </button>
          <span className="text-sm text-muted-foreground">
            {filteredBusinesses.length} {filteredBusinesses.length === 1 ? "business" : "businesses"}
            {searchQuery && ` matching "${searchQuery}"`}
          </span>
        </div>
      )}

      {/* Business cards */}
      {filteredBusinesses.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Building2 className="w-12 h-12 text-muted-foreground mb-4" />
            {searchQuery ? (
              <>
                <h3 className="text-lg font-semibold text-foreground mb-2">No results found</h3>
                <p className="text-sm text-muted-foreground mb-4">No businesses match "{searchQuery}"</p>
                <Button variant="outline" onClick={() => setSearchQuery("")}>Clear search</Button>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-foreground mb-2">No businesses yet</h3>
                <p className="text-sm text-muted-foreground mb-4 text-center max-w-md">
                  Create your first business profile to start training AI models with specific business information.
                </p>
                <Button onClick={() => setIsDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Your First Business
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredBusinesses.map((business) => {
            const isSelected = selectedIds.has(business.id);
            return (
              <Card
                key={business.id}
                className={`bg-card border-border hover:border-primary/50 transition-colors relative ${
                  isSelected ? "border-primary ring-1 ring-primary/30" : ""
                }`}
              >
                {/* Checkbox overlay in top-left */}
                <div className="absolute top-3 left-3 z-10">
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleSelect(business.id)}
                    className="bg-background border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                  />
                </div>

                <CardHeader className="pl-10">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Building2 className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-card-foreground">{business.name}</CardTitle>
                        {business.businessType && (
                          <CardDescription className="text-xs">{business.businessType}</CardDescription>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      {(business as any).internalSource === "rogue" && (
                        <Badge className="text-xs bg-blue-500/20 text-blue-400 border-blue-500/30">Rogue</Badge>
                      )}
                      {(business as any).internalSource === "ranklocal" && (
                        <Badge className="text-xs bg-green-500/20 text-green-400 border-green-500/30">Rank Local</Badge>
                      )}
                      {!(business as any).internalSource && (business as any).agencyId && (
                        <Badge className="text-xs bg-purple-500/20 text-purple-400 border-purple-500/30">White-Label</Badge>
                      )}
                      {(business as any).isArchived && (
                        <Badge variant="secondary" className="text-xs">Archived</Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3">
                  {business.location && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <MapPin className="w-4 h-4" />
                      {business.location}
                    </div>
                  )}
                  {business.phone && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Phone className="w-4 h-4" />
                      {business.phone}
                    </div>
                  )}
                  {business.website && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Globe className="w-4 h-4" />
                      <a href={business.website} target="_blank" rel="noopener noreferrer" className="hover:text-primary truncate">
                        {business.website}
                      </a>
                    </div>
                  )}
                  {(business.certifications || business.awards || business.yearsInBusiness) && (
                    <div className="flex items-center gap-2 text-sm text-purple-400 mt-2 pt-2 border-t border-border">
                      <Shield className="w-4 h-4" />
                      <span>Credibility data available</span>
                    </div>
                  )}
                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" size="sm" onClick={() => handleEdit(business)} className="flex-1">
                      <Pencil className="w-4 h-4 mr-2" />
                      Edit
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(business.id)}
                      disabled={deleteBusiness.isPending}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
