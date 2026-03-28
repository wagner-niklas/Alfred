"use client";

import { PropsWithChildren, useEffect, useState, type FC } from "react";
import Image from "next/image";
import { XIcon, Paperclip, FileText, MicIcon, SquareIcon, Wand2Icon, SparklesIcon } from "lucide-react";
import {
  AttachmentPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  useAssistantState,
  useAssistantApi,
  useAui,
} from "@assistant-ui/react";
import {
  Tooltip,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import {
  ModelSelector,
  type ModelOption,
} from "@/components/assistant-ui/model-selector";
import { cn, getCookie } from "@/lib/utils";

const useSpeechRecognitionSupported = () => {
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      setSupported(null);
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    setSupported(!!SpeechRecognition);
  }, []);

  return supported; // true | false | null
};

const useFileSrc = (file: File | undefined) => {
  const [src, setSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!file) {
      setSrc(undefined);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setSrc(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  return src;
};

const useAttachmentSrc = () => {
  // Use `any` for the selector state to avoid depending on the
  // (incomplete) AssistantState typings from the library. At runtime,
  // the attachment client exposes `attachment` with `type`, `file`,
  // and `content` as used below.
  const { file, src } = useAssistantState(
    (state: any): { file?: File; src?: string } => {
      const attachment = state?.attachment;
      if (!attachment || attachment.type !== "image") return {};
      if (attachment.file) return { file: attachment.file };

      const src = attachment.content
        ?.filter((c: any) => c.type === "image")[0]
        ?.image;

      if (!src) return {};
      return { src };
    },
  );

  return useFileSrc(file) ?? src;
};

type AttachmentPreviewProps = {
  src: string;
};

const AttachmentPreview: FC<AttachmentPreviewProps> = ({ src }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  return (
    <Image
      src={src}
      alt="Image Preview"
      width={1}
      height={1}
      className={
        isLoaded
          ? "aui-attachment-preview-image-loaded block h-auto max-h-[80vh] w-auto max-w-full object-contain"
          : "aui-attachment-preview-image-loading hidden"
      }
      onLoadingComplete={() => setIsLoaded(true)}
      priority={false}
    />
  );
};

const AttachmentPreviewDialog: FC<PropsWithChildren> = ({ children }) => {
  const src = useAttachmentSrc();

  if (!src) return children;

  return (
    <Dialog>
      <DialogTrigger
        className="aui-attachment-preview-trigger cursor-pointer transition-colors hover:bg-accent/50"
        asChild
      >
        {children}
      </DialogTrigger>
      <DialogContent className="aui-attachment-preview-dialog-content p-2 sm:max-w-3xl [&_svg]:text-background [&>button]:rounded-full [&>button]:bg-foreground/60 [&>button]:p-1 [&>button]:opacity-100 [&>button]:!ring-0 [&>button]:hover:[&_svg]:text-destructive">
        <DialogTitle className="aui-sr-only sr-only">
          Image Attachment Preview
        </DialogTitle>
        <div className="aui-attachment-preview relative mx-auto flex max-h-[80dvh] w-full items-center justify-center overflow-hidden bg-background">
          <AttachmentPreview src={src} />
        </div>
      </DialogContent>
    </Dialog>
  );
};

const AttachmentThumb: FC = () => {
  const isImage = useAssistantState(
    (state: any) => state.attachment?.type === "image",
  );
  const src = useAttachmentSrc();

  return (
    <Avatar className="aui-attachment-tile-avatar h-full w-full rounded-none">
      {isImage && src ? (
        <AvatarImage
          src={src}
          alt="Attachment preview"
          className="aui-attachment-tile-image object-cover"
        />
      ) : (
        <AvatarFallback delayMs={0}>
          <FileText className="aui-attachment-tile-fallback-icon size-8 text-muted-foreground" />
        </AvatarFallback>
      )}
    </Avatar>
  );
};

const AttachmentUI: FC = () => {
  // Cast to any to work around incomplete AssistantClient typings
  const api = useAssistantApi() as any;
  const isComposer = api.attachment?.source === "composer";

  const isImage = useAssistantState(
    (state: any) => state.attachment?.type === "image",
  );
  const typeLabel = useAssistantState((state: any) => {
    const type = state.attachment?.type as string | undefined;
    switch (type) {
      case "image":
        return "Image";
      case "document":
        return "Document";
      case "file":
        return "File";
      default:
        return "Attachment";
    }
  });

  const tile = (
    <div
      className={cn(
        "aui-attachment-tile size-14 cursor-pointer overflow-hidden rounded-[14px] border bg-muted transition-opacity hover:opacity-75",
        isComposer && "aui-attachment-tile-composer border-foreground/20",
      )}
      role="button"
      id="attachment-tile"
      aria-label={`${typeLabel} attachment`}
    >
      <AttachmentThumb />
    </div>
  );

  return (
    <Tooltip>
      <AttachmentPrimitive.Root
        className={cn(
          "aui-attachment-root relative",
          isImage &&
            "aui-attachment-root-composer only:[&>#attachment-tile]:size-24",
        )}
      >
        {isImage ? (
          <AttachmentPreviewDialog>{tile}</AttachmentPreviewDialog>
        ) : (
          tile
        )}
        {isComposer && <AttachmentRemove />}
      </AttachmentPrimitive.Root>
      <TooltipContent side="top">
        <AttachmentPrimitive.Name />
      </TooltipContent>
    </Tooltip>
  );
};

const AttachmentRemove: FC = () => {
  return (
    <AttachmentPrimitive.Remove asChild>
      <TooltipIconButton
        tooltip="Remove file"
        className="aui-attachment-tile-remove absolute top-1.5 right-1.5 size-3.5 rounded-full bg-white text-muted-foreground opacity-100 shadow-sm hover:!bg-white [&_svg]:text-black hover:[&_svg]:text-destructive"
        side="top"
      >
        <XIcon className="aui-attachment-remove-icon size-3 dark:stroke-[2.5px]" />
      </TooltipIconButton>
    </AttachmentPrimitive.Remove>
  );
};

export const UserMessageAttachments: FC = () => {
  return (
    <div className="aui-user-message-attachments-end col-span-full col-start-1 row-start-1 flex w-full flex-row justify-end gap-2">
      <MessagePrimitive.Attachments components={{ Attachment: AttachmentUI }} />
    </div>
  );
};

export const ComposerAttachments: FC = () => {
  return (
    <div className="aui-composer-attachments mb-2 flex w-full flex-row items-center gap-2 overflow-x-auto px-1.5 pt-0.5 pb-1 empty:hidden">
      <ComposerPrimitive.Attachments
        components={{ Attachment: AttachmentUI }}
      />
    </div>
  );
};

export const ComposerAddAttachment: FC = () => {
  // Cast to any to work around incomplete AssistantClient typings
  const aui = useAui() as any;
  const speechSupported = useSpeechRecognitionSupported();
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [showEmptyEnhanceHint, setShowEmptyEnhanceHint] = useState(false);

  type SettingsResponse = {
    // Effective default model (derived on the server). Kept for backwards
    // compatibility and as a fallback when no models list is present.
    model?: {
      deployment?: string;
      baseURL?: string;
      provider?: string;
    } | null;
    // Full list of configured chat models from the Settings page. We only
    // depend on the small subset of fields we actually need for the
    // selector UI.
    models?:
      | {
          id?: string;
          name?: string;
          provider?: string;
          baseURL?: string;
          apiVersion?: string;
          deployment?: string;
        }[]
      | null;
  };

  // Model options are derived from the current user's settings so that
  // the selector only exposes models they have configured.
  const [modelOptions, setModelOptions] = useState<ModelOption[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadModelOptions() {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) {
          console.error("Failed to load settings for model selector", res.status);
          return;
        }

        const data = (await res.json()) as SettingsResponse;

        if (cancelled) return;

        const options: ModelOption[] = [];

        // Prefer the explicit list of configured chat models when present.
        if (data.models && data.models.length > 0) {
          data.models.forEach((m, index) => {
            const providerLabel = m.provider ?? "azure-openai";
            const deployment = m.deployment ?? "";

            // Show the deployment name prominently in the selector so
            // users can easily map options to their configured models.
            const displayName = deployment || m.name || `Chat model ${index + 1}`;

            options.push({
              // Prefer an explicit id when present, otherwise fall back to
              // deployment, and finally to a stable synthetic id.
              id: m.id ?? deployment ?? `model-${index + 1}`,
              name: displayName,
              description: deployment
                ? `${providerLabel} · ${deployment}`
                : providerLabel,
              icon: <SparklesIcon />,
            });
          });
        } else if (data.model) {
          // Backwards-compatible fallback: derive a single option from the
          // effective default model.
          const deployment = data.model.deployment || "default";
          const providerLabel = data.model.provider ?? "azure-openai";

          options.push({
            id: deployment,
            // Use the deployment name instead of a generic label.
            name: deployment,
            description: `${providerLabel} · ${deployment}`,
            icon: <SparklesIcon />,
          });
        }

        // If no usable model configuration exists (e.g. new user), expose a
        // disabled placeholder option so the selector is still visible and
        // clearly instructs the user to configure a model first.
        if (options.length === 0) {
          options.push({
            id: "no-model-configured",
            name: "No model configured",
            description: "Configure a chat model in Settings first",
            disabled: true,
          });
        }

        setModelOptions(options);
      } catch (error) {
        if (cancelled) return;
        console.error("Error loading settings for model selector", error);
        // On error, still show a disabled placeholder so new users understand
        // they must configure a model.
        setModelOptions([
          {
            id: "no-model-configured",
            name: "No model configured",
            description: "Configure a chat model in Settings first",
            disabled: true,
          },
        ]);
      }
    }

    void loadModelOptions();

    return () => {
      cancelled = true;
    };
  }, []);

  const unsupportedTooltip =
    "SpeechRecognition is not supported in this browser. Try using Chrome, Edge, or Safari.";

  const isSupported = speechSupported === true;
  const isUnsupported = speechSupported === false;

  const tooltipText = isSupported
    ? "Start dictation"
    : isUnsupported
    ? unsupportedTooltip
    : "Checking microphone support…";

  const disabled = !isSupported; // disable when unsupported or unknown

  const handleEnhancePrompt = async () => {
    try {
      const composerState = aui.composer().getState();
      const currentText = (composerState.text ?? "").toString();

      if (!currentText.trim()) {
        setShowEmptyEnhanceHint(true);
        window.setTimeout(() => {
          setShowEmptyEnhanceHint(false);
        }, 2000);
        return;
      }

      setIsEnhancing(true);

      const response = await fetch("/api/enhance-prompt", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt: currentText }),
      });

      if (!response.ok) {
        console.error("Enhance prompt request failed", await response.text());
        return;
      }

      const data = (await response.json()) as {
        enhancedPrompt?: string;
      };

      const nextText = (data.enhancedPrompt ?? currentText).toString();
      aui.composer().setText(nextText);
    } catch (error) {
      console.error("Error enhancing prompt:", error);
    } finally {
      setIsEnhancing(false);
    }
  };

  return (
    <div className="aui-composer-add-attachment-wrapper flex flex-col items-end gap-1">
      <div className="aui-composer-add-attachment-group inline-flex items-center gap-2">
        {/* Image button */}
      <ComposerPrimitive.AddAttachment asChild>
        <TooltipIconButton
          tooltip="Add an Image"
          side="bottom"
          variant="ghost"
          size="icon"
          className="aui-composer-add-attachment size-[34px] rounded-full p-1 text-xs font-semibold hover:bg-muted-foreground/15 dark:border-muted-foreground/15 dark:hover:bg-muted-foreground/30"
          aria-label="Add Attachment"
        >
          <Paperclip className="aui-attachment-add-icon size-5 stroke-[1.5px]" />
        </TooltipIconButton>
      </ComposerPrimitive.AddAttachment>

      {/* Single mic / dictation button */}
      <ComposerPrimitive.If dictation={false}>
        <ComposerPrimitive.Dictate asChild>
          <TooltipIconButton
            tooltip={tooltipText}
            side="bottom"
            variant="ghost"
            size="icon"
            disabled={disabled}
            className={cn(
              "size-[34px] rounded-full p-1 text-xs font-semibold dark:border-muted-foreground/15",
              disabled
                ? "opacity-40 hover:bg-transparent"
                : "hover:bg-muted-foreground/15 dark:hover:bg-muted-foreground/30",
            )}
            aria-label={
              isSupported
                ? "Start dictation"
                : isUnsupported
                ? "Dictation not supported"
                : "Checking microphone support"
            }
          >
            <MicIcon className="size-5 stroke-[1.5px]" />
          </TooltipIconButton>
        </ComposerPrimitive.Dictate>
      </ComposerPrimitive.If>

      <ComposerPrimitive.If dictation>
        <ComposerPrimitive.StopDictation asChild>
          <TooltipIconButton
            tooltip="Stop dictation"
            side="bottom"
            variant="ghost"
            size="icon"
            className="size-[34px] rounded-full p-1 text-xs font-semibold hover:bg-muted-foreground/15 dark:border-muted-foreground/15 dark:hover:bg-muted-foreground/30"
            aria-label="Stop dictation"
          >
            <SquareIcon className="size-5 stroke-[1.5px] animate-pulse" />
          </TooltipIconButton>
        </ComposerPrimitive.StopDictation>
      </ComposerPrimitive.If>

      {/* Enhance prompt button + model selector (when configured) */}
      <div className="relative flex items-center gap-2">
        {modelOptions && modelOptions.length > 0 && (
          <ModelSelector
            models={modelOptions}
            size="sm"
            variant="muted"
            contentClassName="min-w-[220px]"
          />
        )}
        {showEmptyEnhanceHint && (
          <div className="aui-composer-enhance-empty-hint absolute -top-9 right-0 z-20 rounded-md border border-border bg-popover px-2 py-1 text-[11px] text-muted-foreground shadow-md">
            Please write your question first.
          </div>
        )}
        <TooltipIconButton
          tooltip="Use the knowledge store to enhance my prompt"
          side="bottom"
          variant="default"
          size="sm"
          className={cn(
            "aui-composer-enhance ml-1 h-[34px] w-auto rounded-full px-3 text-xs font-medium",
            "bg-blue-100 hover:bg-blue-200 text-blue-700",
            "dark:bg-blue-900 dark:hover:bg-blue-800 dark:text-blue-100",
            isEnhancing && "opacity-80 cursor-wait aui-composer-enhance-pulse",
          )}
          disabled={isEnhancing}
          aria-label="Enhance prompt"
          onClick={handleEnhancePrompt}
        >
          <Wand2Icon className="mr-1.5 h-4 w-4" />
          <span>Enhance my question</span>
        </TooltipIconButton>
      </div>
      </div>
    </div>
  );
};