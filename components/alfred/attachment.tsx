"use client";

import { PropsWithChildren, useEffect, useState, type FC } from "react";
import Image from "next/image";
import { XIcon, Paperclip, FileText, MicIcon, SquareIcon } from "lucide-react";
import {
  AttachmentPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  useAssistantState,
  useAssistantApi,
} from "@assistant-ui/react";
import { useShallow } from "zustand/shallow";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
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
  const { file, src } = useAssistantState(
    useShallow(
      ({ attachment }): { file?: File; src?: string } => {
        if (attachment.type !== "image") return {};
        if (attachment.file) return { file: attachment.file };
        const src = attachment.content?.filter((c) => c.type === "image")[0]
          ?.image;
        if (!src) return {};
        return { src };
      },
    ),
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
    ({ attachment }) => attachment.type === "image",
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
  const api = useAssistantApi();
  const isComposer = api.attachment.source === "composer";

  const isImage = useAssistantState(
    ({ attachment }) => attachment.type === "image",
  );
  const typeLabel = useAssistantState(({ attachment }) => {
    const type = attachment.type;
    switch (type) {
      case "image":
        return "Image";
      case "document":
        return "Document";
      case "file":
        return "File";
      default: {
        const _exhaustiveCheck: never = type;
        throw new Error(`Unknown attachment type: ${_exhaustiveCheck}`);
      }
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
  const speechSupported = useSpeechRecognitionSupported();

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

  return (
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
    </div>
  );
};