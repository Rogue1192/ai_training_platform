import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, CheckCircle2, XCircle, Clock, MessageSquare, ChevronDown, ChevronRight, Sparkles, ArrowRight } from "lucide-react";
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

  // Check if a prompt is suggestive
  const isSuggestivePrompt = (prompt: string) => {
    return prompt.includes("I've heard") || 
           prompt.includes("recommended") ||
           prompt.includes("compare") ||
           prompt.includes("reviews") ||
           prompt.includes("suggested") ||
           prompt.includes("hearing good things") ||
           prompt.includes("known for") ||
           prompt.includes("What about") ||
           prompt.includes("Have you heard of") ||
           prompt.includes("worth considering");
  };

  // Check if this is a follow-up prompt (appears after first exchange)
  const isFollowUpPrompt = (prompt: string) => {
    return prompt.includes("What about") ||
           prompt.includes("How does") ||
           prompt.includes("specifically recommended") ||
           prompt.includes("worth considering") ||
           prompt.includes("Have you heard of") ||
           prompt.includes("good option");
  };

  // Group messages into turns (user + assistant pairs)
  const groupMessagesIntoTurns = (messages: ConversationMessage[]) => {
    const turns: Array<{ user: ConversationMessage; assistant: ConversationMessage | null; turnNumber: number; isFollowUp: boolean }> = [];
    
    for (let i = 0; i < messages.length; i += 2) {
      const userMsg = messages[i];
      const assistantMsg = messages[i + 1] || null;
      const turnNumber = Math.floor(i / 2) + 1;
      const isFollowUp = turnNumber > 1;
      
      if (userMsg && userMsg.role === "user") {
        turns.push({ user: userMsg, assistant: assistantMsg, turnNumber, isFollowUp });
      }
    }
    
    return turns;
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
                const turns = groupMessagesIntoTurns(messages);
                const hasMultipleTurns = turns.length > 1;

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
                            Not Achieved
                          </Badge>
                        )}
                        {hasMultipleTurns && (
                          <Badge variant="outline" className="text-xs border-blue-500 text-blue-400">
                            <ArrowRight className="w-3 h-3 mr-1" />
                            Multi-Turn ({turns.length} turns)
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
                        {/* Prompt Used (first prompt) */}
                        <div className="text-sm space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground font-medium">Initial Prompt: </span>
                            {isSuggestivePrompt(conversation.promptUsed) ? (
                              <Badge variant="outline" className="text-xs border-purple-500 text-purple-400">
                                <Sparkles className="w-3 h-3 mr-1" />
                                Suggestive
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs">
                                Neutral
                              </Badge>
                            )}
                          </div>
                          <p className="text-foreground bg-muted/50 p-2 rounded">{conversation.promptUsed}</p>
                        </div>

                        {/* Conversation Turns */}
                        <div className="space-y-4">
                          {turns.map((turn, idx) => (
                            <div key={idx} className="space-y-3">
                              {/* Turn Header for follow-ups */}
                              {turn.isFollowUp && (
                                <div className="flex items-center gap-2 pt-2 border-t border-dashed border-border">
                                  <Badge variant="outline" className="text-xs border-orange-500 text-orange-400">
                                    <ArrowRight className="w-3 h-3 mr-1" />
                                    Follow-up Turn {turn.turnNumber}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground">
                                    (Business not mentioned in previous response)
                                  </span>
                                </div>
                              )}

                              {/* User Message */}
                              <div className="flex justify-end">
                                <div className="max-w-[85%] rounded-lg p-3 bg-primary text-primary-foreground">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-semibold uppercase opacity-75">
                                      {turn.isFollowUp ? "Follow-up Prompt" : "User Prompt"}
                                    </span>
                                    {turn.isFollowUp && isFollowUpPrompt(turn.user.content) && (
                                      <Badge variant="secondary" className="text-xs bg-orange-600/20 text-orange-300 border-0">
                                        Auto-generated
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="text-sm whitespace-pre-wrap leading-relaxed">
                                    {turn.user.content}
                                  </div>
                                </div>
                              </div>

                              {/* Assistant Message */}
                              {turn.assistant && (
                                <div className="flex justify-start">
                                  <div className="max-w-[85%] rounded-lg p-3 bg-muted text-foreground">
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="text-xs font-semibold uppercase opacity-75">
                                        AI Response
                                      </span>
                                      {turn.turnNumber === turns.length && conversation.goalAchieved && (
                                        <Badge variant="default" className="text-xs bg-green-600/20 text-green-300 border-0">
                                          <CheckCircle2 className="w-3 h-3 mr-1" />
                                          Business Mentioned
                                        </Badge>
                                      )}
                                    </div>
                                    <div className="text-sm whitespace-pre-wrap leading-relaxed max-h-[400px] overflow-y-auto">
                                      {turn.assistant.content}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>

                        {/* Summary for multi-turn conversations */}
                        {hasMultipleTurns && (
                          <div className="mt-4 p-3 bg-muted/30 rounded-lg border border-border">
                            <div className="text-sm text-muted-foreground">
                              <span className="font-medium">Summary:</span> This iteration required {turns.length} conversation turns.
                              {conversation.goalAchieved 
                                ? " The business was successfully mentioned after the follow-up prompt."
                                : " The business was not mentioned even after follow-up prompts."}
                            </div>
                          </div>
                        )}
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
