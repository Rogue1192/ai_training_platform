import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Navigation,
  Car,
  Bus,
  Bike,
  PersonStanding,
  Calendar,
  Shield,
  Plus,
  MapPin,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";

const JOURNEY_TYPES = [
  { value: "driving", label: "Driving", icon: Car, description: "Simulates a customer driving to the location" },
  { value: "transit", label: "Transit", icon: Bus, description: "Public transit route to the business" },
  { value: "walking", label: "Walking", icon: PersonStanding, description: "Walking directions to the business" },
  { value: "cycling", label: "Cycling", icon: Bike, description: "Cycling route to the business" },
];

const CUSTOMER_PERSONAS = [
  { value: "residential", label: "Residential", description: "Homeowner needing service" },
  { value: "commercial", label: "Commercial", description: "Business owner or property manager" },
  { value: "emergency", label: "Emergency", description: "Urgent same-day service needed" },
  { value: "maintenance", label: "Maintenance", description: "Scheduled maintenance appointment" },
];

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  running: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  completed: "bg-green-500/15 text-green-400 border-green-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
};

export default function CtrDriveSimulation() {
  const [campaignId, setCampaignId] = useState<string>("");
  const [journeyType, setJourneyType] = useState("driving");
  const [persona, setPersona] = useState("residential");
  const [originAddress, setOriginAddress] = useState("");
  const [destinationAddress, setDestinationAddress] = useState("");
  const [createCalendar, setCreateCalendar] = useState(true);
  const [calendarTitle, setCalendarTitle] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");

  const { data: campaigns = [] } = trpc.ctr.listCampaigns.useQuery();
  const { data: journeys = [], refetch } = trpc.ctr.listDriveJourneys.useQuery(
    { campaignId: parseInt(campaignId) },
    { enabled: !!campaignId }
  );

  const createJourney = trpc.ctr.createDriveJourney.useMutation({
    onSuccess: () => {
      toast.success("Drive journey scheduled");
      setOriginAddress("");
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  function handleSubmit() {
    if (!campaignId || !originAddress || !destinationAddress) {
      toast.error("Please fill in all required fields");
      return;
    }
    createJourney.mutate({
      campaignId: parseInt(campaignId),
      journeyType,
      customerPersona: persona,
      originAddress,
      destinationAddress,
      createCalendarEvent: createCalendar,
      calendarEventTitle: calendarTitle || `${persona} appointment`,
      scheduledFor: scheduledFor || undefined,
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Drive Simulation</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Simulate GPS direction requests to your GBP listing — real browser, real signals
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Setup form */}
        <div className="space-y-5">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Navigation className="h-4 w-4 text-primary" />
                New Journey
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Campaign selector */}
              <div className="space-y-1.5">
                <Label>Campaign <span className="text-destructive">*</span></Label>
                <Select value={campaignId} onValueChange={setCampaignId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a CTR campaign..." />
                  </SelectTrigger>
                  <SelectContent>
                    {campaigns.map((c: any) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.businessName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Journey type */}
              <div className="space-y-1.5">
                <Label>Journey Type</Label>
                <div className="grid grid-cols-2 gap-2">
                  {JOURNEY_TYPES.map((jt) => {
                    const Icon = jt.icon;
                    return (
                      <button
                        key={jt.value}
                        onClick={() => setJourneyType(jt.value)}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors text-left",
                          journeyType === jt.value
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border hover:border-primary/40 text-muted-foreground"
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {jt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Customer persona */}
              <div className="space-y-1.5">
                <Label>Customer Persona</Label>
                <Select value={persona} onValueChange={setPersona}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CUSTOMER_PERSONAS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        <div>
                          <p className="font-medium">{p.label}</p>
                          <p className="text-xs text-muted-foreground">{p.description}</p>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Addresses */}
              <div className="space-y-1.5">
                <Label>Origin Address <span className="text-destructive">*</span></Label>
                <Input
                  placeholder="123 Residential St, Orlando, FL 32801"
                  value={originAddress}
                  onChange={(e) => setOriginAddress(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Destination (Business Address) <span className="text-destructive">*</span></Label>
                <Input
                  placeholder="456 Business Ave, Orlando, FL 32802"
                  value={destinationAddress}
                  onChange={(e) => setDestinationAddress(e.target.value)}
                />
              </div>

              {/* Calendar event */}
              <div className="rounded-lg border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Create Calendar Event</p>
                      <p className="text-xs text-muted-foreground">Makes the journey look like a planned appointment</p>
                    </div>
                  </div>
                  <Switch checked={createCalendar} onCheckedChange={setCreateCalendar} />
                </div>
                {createCalendar && (
                  <Input
                    placeholder="Appointment title (e.g. HVAC Maintenance)"
                    value={calendarTitle}
                    onChange={(e) => setCalendarTitle(e.target.value)}
                  />
                )}
              </div>

              {/* Schedule */}
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  Schedule For
                  <Badge variant="outline" className="text-xs font-normal">Optional</Badge>
                </Label>
                <Input
                  type="datetime-local"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Leave blank to run immediately</p>
              </div>

              {/* Real browser notice */}
              <div className="rounded-lg bg-muted/40 border p-3 flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary shrink-0" />
                <p className="text-xs text-muted-foreground">
                  All drive simulations use <span className="text-foreground font-medium">real Chromium browsers</span> — never headless
                </p>
              </div>

              <Button
                className="w-full gap-2"
                onClick={handleSubmit}
                disabled={createJourney.isPending || !campaignId}
              >
                <Plus className="h-4 w-4" />
                {createJourney.isPending ? "Scheduling..." : "Schedule Journey"}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Journey log */}
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Recent Journeys
          </h2>
          {!campaignId ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">Select a campaign to view journeys</p>
            </div>
          ) : journeys.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">No journeys yet for this campaign</p>
            </div>
          ) : (
            <div className="space-y-2">
              {journeys.map((j: any) => (
                <Card key={j.id}>
                  <CardContent className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2 min-w-0">
                        <Car className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium capitalize">{j.journeyType} · {j.customerPersona}</p>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            <MapPin className="h-3 w-3 inline mr-0.5" />
                            {j.originAddress}
                          </p>
                          {j.createCalendarEvent && (
                            <p className="text-xs text-blue-400 mt-0.5 flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              Calendar event created
                            </p>
                          )}
                        </div>
                      </div>
                      <Badge className={cn("text-xs shrink-0", STATUS_COLORS[j.status] ?? STATUS_COLORS.pending)}>
                        {j.status === "completed" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                        {j.status}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
