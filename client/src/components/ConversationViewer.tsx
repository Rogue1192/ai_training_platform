import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle, Clock, MessageSquare, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface ConversationViewerProps {
  sessionId: number;
  sessionName: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ConversationViewer({ sessionId, sessionName, isOpen, onClose }: ConversationViewerProps) {
  const { data: conversations, isLoading } = trpc.training.getConversations.useQuery(
    { sessionId },
    { enabled: isOpen, refetchInterval: 30000 } // Refresh every 30 seconds for active sessions
  );

  const [expandedIterations, setExpandedIterations] = useState<Set<number>>(new Set([1]));

  const toggleIteration = (iterationNumber: number) => {
    setExpandedIterations((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(iterationNumber)) {
        newSet.delete(iterationNumber);
      } else {
        newSet.add(iterationNumber);
      }
      return newSet;
    });
  };

  const formatTimestamp = (timestamp: number | string | Date) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const formatResponseTime = (ms: number | null) => {
    if (!ms) return "N/A";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col bg-card border-border overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-card-foreground">
            <MessageSquare className="w-5 h-5" />
            Conversation History: {sessionName}
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : !conversations || conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <MessageSquare className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">No conversations yet</p>
            <p className="text-sm">Start the training session to see conversations here.</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
            <div className="space-y-4 pb-4">
              {conversations.map((conversation) => {
                const isExpanded = expandedIterations.has(conversation.iterationNumber);
                const messages = conversation.conversationHistory as ConversationMessage[];

                return (
                  <div
                    key={conversation.id}
                    className="border border-border rounded-lg overflow-hidden bg-background"
                  >
                    {/* Iteration Header */}
                    <button
                      onClick={() => toggleIteration(conversation.iterationNumber)}
                      className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        )}
                        <span className="font-semibold text-foreground">
                          Iteration {conversation.iterationNumber}
                        </span>
                        {conversation.goalAchieved ? (
                          <Badge variant="default" className="bg-green-600 hover:bg-green-700">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Goal Achieved
                          </Badge>
                        ) : (
                          <Badge variant="secondary">
                            <XCircle className="w-3 h-3 mr-1" />
                            In Progress
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatResponseTime(conversation.responseTime)}
                        </span>
                        <span>{formatTimestamp(conversation.createdAt)}</span>
                      </div>
                    </button>

                    {/* Conversation Content */}
                    {isExpanded && (
                      <div className="border-t border-border p-4 space-y-4">
                        {/* Prompt Used */}
                        <div className="text-sm">
                          <span className="text-muted-foreground font-medium">Prompt: </span>
                          <span className="text-foreground">{conversation.promptUsed}</span>
                        </div>

                        {/* Messages */}
                        <div className="space-y-3">
                          {messages.map((message, idx) => (
                            <div
                              key={idx}
                              className={cn(
                                "flex",
                                message.role === "user" ? "justify-end" : "justify-start"
                              )}
                            >
                              <div
                                className={cn(
                                  "max-w-[85%] rounded-lg p-3",
                                  message.role === "user"
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted text-foreground"
                                )}
                              >
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-xs font-semibold uppercase opacity-75">
                                    {message.role === "user" ? "User Prompt" : "AI Response"}
                                  </span>
                                </div>
                                <div className="text-sm whitespace-pre-wrap leading-relaxed max-h-[400px] overflow-y-auto">
                                  {message.content}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default ConversationViewer;
