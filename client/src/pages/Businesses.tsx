import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, Plus, Building2, MapPin, Phone, Globe, Trash2, Pencil, Shield, Key } from "lucide-react";

export default function Businesses() {
  const { data: businesses, isLoading, refetch } = trpc.business.list.useQuery();
  const createBusiness = trpc.business.create.useMutation();
  const updateBusiness = trpc.business.update.useMutation();
  const deleteBusiness = trpc.business.delete.useMutation();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingBusiness, setEditingBusiness] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState("basic");
  
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
    wpAdminUrl: "",
    wpUsername: "",
    wpPassword: "",
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
      wpAdminUrl: "",
      wpUsername: "",
      wpPassword: "",
    });
    setEditingBusiness(null);
    setActiveTab("basic");
  };

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
      wpAdminUrl: business.wpAdminUrl || "",
      wpUsername: business.wpUsername || "",
      wpPassword: "", // Never populate password field
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
    
    if (!payload.wpPassword) {
      delete payload.wpPassword;
    }

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
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Failed to delete business");
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Businesses</h1>
          <p className="text-muted-foreground mt-2">Manage target businesses for AI training</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Add Business
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-card border-border">
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle className="text-card-foreground">{editingBusiness ? "Edit Business" : "Add New Business"}</DialogTitle>
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
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="e.g., Acme HVAC Services"
                        required
                        className="bg-background border-input"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="businessType">Business Type</Label>
                      <Input
                        id="businessType"
                        value={formData.businessType}
                        onChange={(e) => setFormData({ ...formData, businessType: e.target.value })}
                        placeholder="e.g., HVAC Company"
                        className="bg-background border-input"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="location">Location</Label>
                      <Input
                        id="location"
                        value={formData.location}
                        onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                        placeholder="e.g., Phoenix, AZ"
                        className="bg-background border-input"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone">Phone</Label>
                      <Input
                        id="phone"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        placeholder="e.g., (555) 123-4567"
                        className="bg-background border-input"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="website">Website</Label>
                      <Input
                        id="website"
                        value={formData.website}
                        onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                        placeholder="e.g., https://example.com"
                        className="bg-background border-input"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="clientType">Client Type</Label>
                      <Select 
                        value={formData.clientType} 
                        onValueChange={(value) => setFormData({ ...formData, clientType: value })}
                      >
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
                      <Input
                        id="contactName"
                        value={formData.contactName}
                        onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                        placeholder="e.g., John Smith"
                        className="bg-background border-input"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="contactEmail">Contact Email</Label>
                      <Input
                        id="contactEmail"
                        type="email"
                        value={formData.contactEmail}
                        onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                        placeholder="e.g., john@example.com"
                        className="bg-background border-input"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="address">Address</Label>
                    <Input
                      id="address"
                      value={formData.address}
                      onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                      placeholder="e.g., 123 Main St, Phoenix, AZ 85001"
                      className="bg-background border-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      placeholder="Brief description of the business and services"
                      rows={3}
                      className="bg-background border-input"
                    />
                  </div>
                </TabsContent>
                
                <TabsContent value="credibility" className="space-y-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="yearsInBusiness">Years in Business</Label>
                      <Input
                        id="yearsInBusiness"
                        type="number"
                        value={formData.yearsInBusiness}
                        onChange={(e) => setFormData({ ...formData, yearsInBusiness: e.target.value })}
                        placeholder="e.g., 15"
                        className="bg-background border-input"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bbbRating">BBB Rating</Label>
                      <Input
                        id="bbbRating"
                        value={formData.bbbRating}
                        onChange={(e) => setFormData({ ...formData, bbbRating: e.target.value })}
                        placeholder="e.g., A+"
                        className="bg-background border-input"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="certifications">Certifications</Label>
                    <Input
                      id="certifications"
                      value={formData.certifications}
                      onChange={(e) => setFormData({ ...formData, certifications: e.target.value })}
                      placeholder="e.g., NATE Certified, EPA Certified"
                      className="bg-background border-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="licenses">Licenses</Label>
                    <Input
                      id="licenses"
                      value={formData.licenses}
                      onChange={(e) => setFormData({ ...formData, licenses: e.target.value })}
                      placeholder="e.g., TX HVAC License #12345"
                      className="bg-background border-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="awards">Awards & Recognition</Label>
                    <Input
                      id="awards"
                      value={formData.awards}
                      onChange={(e) => setFormData({ ...formData, awards: e.target.value })}
                      placeholder="e.g., Best of Dallas 2024"
                      className="bg-background border-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="warranties">Warranties & Guarantees</Label>
                    <Input
                      id="warranties"
                      value={formData.warranties}
                      onChange={(e) => setFormData({ ...formData, warranties: e.target.value })}
                      placeholder="e.g., Lifetime warranty on all installations"
                      className="bg-background border-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="differentiators">Key Differentiators</Label>
                    <Textarea
                      id="differentiators"
                      value={formData.differentiators}
                      onChange={(e) => setFormData({ ...formData, differentiators: e.target.value })}
                      placeholder="e.g., Only company in DFW with 24/7 emergency service"
                      rows={2}
                      className="bg-background border-input"
                    />
                  </div>
                </TabsContent>
                
                <TabsContent value="publishing" className="space-y-4 py-4">
                  <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 mb-4">
                    <h3 className="text-sm font-medium text-primary flex items-center gap-2 mb-2">
                      <Key className="w-4 h-4" />
                      Auto-Publishing Credentials
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Enter the client's CMS admin credentials to enable automated publishing of credibility content pages. Works with any CMS. Passwords are encrypted before storage.
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="wpAdminUrl">Admin URL</Label>
                    <Input
                      id="wpAdminUrl"
                      value={formData.wpAdminUrl}
                      onChange={(e) => setFormData({ ...formData, wpAdminUrl: e.target.value })}
                      placeholder="e.g., https://example.com/wp-admin or /admin"
                      className="bg-background border-input"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="wpUsername">Username</Label>
                      <Input
                        id="wpUsername"
                        value={formData.wpUsername}
                        onChange={(e) => setFormData({ ...formData, wpUsername: e.target.value })}
                        placeholder="e.g., admin"
                        className="bg-background border-input"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="wpPassword">Password {editingBusiness && "(Leave blank to keep current)"}</Label>
                      <Input
                        id="wpPassword"
                        type="password"
                        value={formData.wpPassword}
                        onChange={(e) => setFormData({ ...formData, wpPassword: e.target.value })}
                        placeholder="••••••••"
                        className="bg-background border-input"
                      />
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
              
              <DialogFooter className="mt-6">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createBusiness.isPending || updateBusiness.isPending}>
                  {createBusiness.isPending || updateBusiness.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : editingBusiness ? (
                    "Update Business"
                  ) : (
                    "Create Business"
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {businesses && businesses.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Building2 className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No businesses yet</h3>
            <p className="text-sm text-muted-foreground mb-4 text-center max-w-md">
              Create your first business profile to start training AI models with specific business information.
            </p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Your First Business
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {businesses?.map((business) => (
            <Card key={business.id} className="bg-card border-border hover:border-primary/50 transition-colors">
              <CardHeader>
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
                
                {/* Show credibility indicators if present */}
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
          ))}
        </div>
      )}
    </div>
  );
}
