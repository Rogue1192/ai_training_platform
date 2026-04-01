import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Mail, Send, Eye, Trophy, BarChart3, UserPlus, Flag, Loader2, CheckCircle2, XCircle } from "lucide-react";

export default function EmailManagement() {
  const [testEmail, setTestEmail] = useState("");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<string>("");
  const [milestoneData, setMilestoneData] = useState({
    milestone: "",
    milestoneDescription: "",
    nextStep: "",
  });

  // Queries
  const campaignsQuery = trpc.campaign.list.useQuery();

  // Mutations
  const sendTestMutation = trpc.email.sendTest.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success("Test email sent!", { description: `Message ID: ${data.messageId}` });
      } else {
        toast.error("Failed to send test email", { description: data.error });
      }
    },
    onError: (err) => toast.error("Error", { description: err.message }),
  });

  const sendWinMutation = trpc.email.sendWinNotification.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success("Win notification sent!", { description: `Message ID: ${data.messageId}` });
      } else {
        toast.error("Failed to send", { description: data.error });
      }
    },
    onError: (err) => toast.error("Error", { description: err.message }),
  });

  const sendReportMutation = trpc.email.sendVisibilityReport.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success("Visibility report sent!", { description: `Message ID: ${data.messageId}` });
      } else {
        toast.error("Failed to send", { description: data.error });
      }
    },
    onError: (err) => toast.error("Error", { description: err.message }),
  });

  const sendWelcomeMutation = trpc.email.sendWelcome.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success("Welcome email sent!", { description: `Message ID: ${data.messageId}` });
      } else {
        toast.error("Failed to send", { description: data.error });
      }
    },
    onError: (err) => toast.error("Error", { description: err.message }),
  });

  const sendMilestoneMutation = trpc.email.sendMilestone.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success("Milestone email sent!", { description: `Message ID: ${data.messageId}` });
      } else {
        toast.error("Failed to send", { description: data.error });
      }
    },
    onError: (err) => toast.error("Error", { description: err.message }),
  });

  // Preview queries
  const winPreview = trpc.email.previewWinEmail.useQuery(
    { campaignId: 0 },
    { enabled: false }
  );
  const reportPreview = trpc.email.previewVisibilityReport.useQuery(
    undefined,
    { enabled: false }
  );

  const handlePreview = async (type: string) => {
    setPreviewType(type);
    try {
      if (type === "win") {
        const result = await winPreview.refetch();
        const html = result.data?.html;
        setPreviewHtml(html ?? null);
      } else if (type === "report") {
        const result = await reportPreview.refetch();
        const html = result.data?.html;
        setPreviewHtml(html ?? null);
      }
    } catch (err) {
      toast.error("Failed to load preview");
    }
  };

  const campaigns = campaignsQuery.data || [];
  const isAnySending = sendTestMutation.isPending || sendWinMutation.isPending || sendReportMutation.isPending || sendWelcomeMutation.isPending || sendMilestoneMutation.isPending;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Mail className="h-6 w-6 text-blue-500" />
          Email Management
        </h1>
        <p className="text-muted-foreground mt-1">
          Send branded emails to clients via <span className="text-blue-400 font-medium">my.aianswerforge.com</span>
        </p>
      </div>

      {/* Status Card */}
      <Card className="border-green-500/20 bg-green-500/5">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-500" />
            <div>
              <p className="font-medium text-green-400">Resend Integration Active</p>
              <p className="text-sm text-muted-foreground">Sending from updates@my.aianswerforge.com</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="send" className="space-y-4">
        <TabsList>
          <TabsTrigger value="send">Send Emails</TabsTrigger>
          <TabsTrigger value="preview">Preview Templates</TabsTrigger>
          <TabsTrigger value="test">Test Integration</TabsTrigger>
        </TabsList>

        {/* Send Emails Tab */}
        <TabsContent value="send" className="space-y-4">
          {/* Campaign Selector */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Select Campaign</CardTitle>
              <CardDescription>Choose a campaign to send emails for</CardDescription>
            </CardHeader>
            <CardContent>
              <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a campaign..." />
                </SelectTrigger>
                <SelectContent>
                  {campaigns.map((c: any) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.campaignName} — {c.businessName || `Business #${c.businessId}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {selectedCampaignId && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Win Notification */}
              <Card className="border-yellow-500/20">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Trophy className="h-4 w-4 text-yellow-500" />
                    Win Notification
                  </CardTitle>
                  <CardDescription>Send ranking wins to the client</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    Detects recent wins and sends a branded email with the results and current visibility score.
                  </p>
                  <Button
                    onClick={() => sendWinMutation.mutate({ campaignId: Number(selectedCampaignId) })}
                    disabled={isAnySending}
                    className="w-full"
                    variant="outline"
                  >
                    {sendWinMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                    Send Win Email
                  </Button>
                </CardContent>
              </Card>

              {/* Visibility Report */}
              <Card className="border-blue-500/20">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-blue-500" />
                    Visibility Report
                  </CardTitle>
                  <CardDescription>Send periodic visibility report</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    Sends a comprehensive visibility report with scores, platform breakdown, and before/after comparison.
                  </p>
                  <Button
                    onClick={() => sendReportMutation.mutate({ campaignId: Number(selectedCampaignId) })}
                    disabled={isAnySending}
                    className="w-full"
                    variant="outline"
                  >
                    {sendReportMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                    Send Report Email
                  </Button>
                </CardContent>
              </Card>

              {/* Welcome Email */}
              <Card className="border-green-500/20">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <UserPlus className="h-4 w-4 text-green-500" />
                    Welcome Email
                  </CardTitle>
                  <CardDescription>Send onboarding welcome</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">
                    Sends a branded welcome email explaining the campaign process and next steps.
                  </p>
                  <Button
                    onClick={() => sendWelcomeMutation.mutate({ campaignId: Number(selectedCampaignId) })}
                    disabled={isAnySending}
                    className="w-full"
                    variant="outline"
                  >
                    {sendWelcomeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                    Send Welcome Email
                  </Button>
                </CardContent>
              </Card>

              {/* Milestone Email */}
              <Card className="border-purple-500/20">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Flag className="h-4 w-4 text-purple-500" />
                    Milestone Email
                  </CardTitle>
                  <CardDescription>Send custom milestone update</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label className="text-xs">Milestone Title</Label>
                    <Input
                      placeholder="e.g., Content Published"
                      value={milestoneData.milestone}
                      onChange={(e) => setMilestoneData(d => ({ ...d, milestone: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Description</Label>
                    <Input
                      placeholder="e.g., 8 AI-optimized pages are now live"
                      value={milestoneData.milestoneDescription}
                      onChange={(e) => setMilestoneData(d => ({ ...d, milestoneDescription: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Next Step</Label>
                    <Input
                      placeholder="e.g., We're now submitting URLs for indexing"
                      value={milestoneData.nextStep}
                      onChange={(e) => setMilestoneData(d => ({ ...d, nextStep: e.target.value }))}
                    />
                  </div>
                  <Button
                    onClick={() => sendMilestoneMutation.mutate({
                      campaignId: Number(selectedCampaignId),
                      ...milestoneData,
                    })}
                    disabled={isAnySending || !milestoneData.milestone}
                    className="w-full"
                    variant="outline"
                  >
                    {sendMilestoneMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                    Send Milestone Email
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* Preview Templates Tab */}
        <TabsContent value="preview" className="space-y-4">
          <div className="flex gap-2 mb-4">
            <Button
              variant={previewType === "win" ? "default" : "outline"}
              onClick={() => handlePreview("win")}
              size="sm"
            >
              <Eye className="h-4 w-4 mr-2" />
              Win Notification
            </Button>
            <Button
              variant={previewType === "report" ? "default" : "outline"}
              onClick={() => handlePreview("report")}
              size="sm"
            >
              <Eye className="h-4 w-4 mr-2" />
              Visibility Report
            </Button>
          </div>

          {previewHtml && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  {previewType === "win" ? "Win Notification" : "Visibility Report"} Preview
                </CardTitle>
                <CardDescription>This is how the email will appear in the client's inbox</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="border border-border rounded-lg overflow-hidden bg-white">
                  <iframe
                    srcDoc={previewHtml}
                    className="w-full h-[700px] border-0"
                    title="Email Preview"
                    sandbox="allow-same-origin"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {!previewHtml && (
            <Card className="border-dashed">
              <CardContent className="pt-6 text-center text-muted-foreground">
                <Eye className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Click a template button above to preview it</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Test Integration Tab */}
        <TabsContent value="test" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Send Test Email</CardTitle>
              <CardDescription>
                Verify the Resend integration by sending a test email to any address
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Recipient Email</Label>
                <div className="flex gap-2">
                  <Input
                    type="email"
                    placeholder="your@email.com"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                  />
                  <Button
                    onClick={() => sendTestMutation.mutate({ toEmail: testEmail })}
                    disabled={!testEmail || sendTestMutation.isPending}
                  >
                    {sendTestMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Send className="h-4 w-4 mr-2" />
                    )}
                    Send Test
                  </Button>
                </div>
              </div>

              <div className="rounded-lg bg-muted/50 p-4 space-y-2">
                <p className="text-sm font-medium">Integration Details</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <span className="text-muted-foreground">Provider</span>
                  <span>Resend</span>
                  <span className="text-muted-foreground">From Domain</span>
                  <span className="text-blue-400">my.aianswerforge.com</span>
                  <span className="text-muted-foreground">From Address</span>
                  <span>updates@my.aianswerforge.com</span>
                  <span className="text-muted-foreground">Reply-To</span>
                  <span>support@my.aianswerforge.com</span>
                  <span className="text-muted-foreground">Status</span>
                  <Badge variant="outline" className="w-fit border-green-500/30 text-green-400">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Active
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
