"use client";

import {
  memo,
  useState,
  useEffect,
  createContext,
  useContext,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { type VariantProps } from "class-variance-authority";
import { CheckIcon } from "lucide-react";
import { useAssistantApi } from "@assistant-ui/react";
import { cn } from "@/lib/utils";
import {
  SelectRoot,
  SelectTrigger,
  SelectContent,
  SelectItem,
  selectTriggerVariants,
} from "@/components/assistant-ui/select";

export type ModelOption = {
  id: string;
  name: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
};

// Local storage key used to persist the last selected model on the client.
// This keeps the selector stable across composer re-mounts and follow-up
// questions without requiring any server-side schema changes.
const MODEL_SELECTOR_STORAGE_KEY = "alfred:model-selector:model-id";

type ModelSelectorContextValue = {
  models: ModelOption[];
  value: string | undefined;
};

const ModelSelectorContext = createContext<ModelSelectorContextValue | null>(
  null,
);

function useModelSelectorContext() {
  const ctx = useContext(ModelSelectorContext);
  if (!ctx) {
    throw new Error(
      "ModelSelector sub-components must be used within ModelSelector.Root",
    );
  }
  return ctx;
}

export type ModelSelectorRootProps = {
  models: ModelOption[];
  value?: string;
  onValueChange?: (value: string) => void;
  defaultValue?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  children: ReactNode;
};

function ModelSelectorRoot({
  models,
  defaultValue: defaultValueProp,
  children,
  value,
  ...selectProps
}: ModelSelectorRootProps) {
  const defaultValue = defaultValueProp ?? models[0]?.id;
  return (
    <ModelSelectorContext.Provider value={{ models, value }}>
      <SelectRoot
        {...(defaultValue !== undefined ? { defaultValue } : undefined)}
        {...(value !== undefined ? { value } : undefined)}
        {...selectProps}
      >
        {children}
      </SelectRoot>
    </ModelSelectorContext.Provider>
  );
}

export type ModelSelectorTriggerProps = ComponentPropsWithoutRef<
  typeof SelectTrigger
>;

function ModelSelectorTrigger({
  className,
  variant,
  size,
  children,
  ...props
}: ModelSelectorTriggerProps) {
  return (
    <SelectTrigger
      data-slot="model-selector-trigger"
      variant={variant}
      size={size}
      className={cn("aui-model-selector-trigger", className)}
      {...props}
    >
      {children ?? <ModelSelectorValue />}
    </SelectTrigger>
  );
}

/**
 * Renders the selected model display in the trigger.
 *
 * Bypasses Radix Select.Value to avoid the empty-on-SSR issue caused by
 * Select items living inside a Portal (not rendered server-side).
 * Falls back to Select.Value for uncontrolled (defaultValue-only) usage.
 */
function ModelSelectorValue() {
  const { models, value } = useModelSelectorContext();
  const selectedModel =
    value != null ? models.find((m) => m.id === value) : undefined;

  if (!selectedModel) {
    return <SelectPrimitive.Value />;
  }

  return (
    <span>
      <span className="flex items-center gap-2">
        {selectedModel.icon && (
          <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">
            {selectedModel.icon}
          </span>
        )}
        <span className="truncate font-medium">{selectedModel.name}</span>
      </span>
    </span>
  );
}

export type ModelSelectorContentProps = ComponentPropsWithoutRef<
  typeof SelectContent
>;

function ModelSelectorContent({
  className,
  children,
  ...props
}: ModelSelectorContentProps) {
  const { models } = useModelSelectorContext();

  return (
    <SelectContent
      data-slot="model-selector-content"
      className={cn("min-w-[180px]", className)}
      {...props}
    >
      {children ??
        models.map((model) => (
          <ModelSelectorItem
            key={model.id}
            model={model}
            {...(model.disabled ? { disabled: true } : undefined)}
          />
        ))}
    </SelectContent>
  );
}

export type ModelSelectorItemProps = Omit<
  ComponentPropsWithoutRef<typeof SelectItem>,
  "value" | "children"
> & {
  model: ModelOption;
};

function ModelSelectorItem({
  model,
  className,
  ...props
}: ModelSelectorItemProps) {
  return (
    <SelectPrimitive.Item
      data-slot="model-selector-item"
      value={model.id}
      textValue={model.name}
      className={cn(
        "relative flex w-full cursor-default select-none items-center gap-2 rounded-lg py-2 pr-9 pl-3 text-sm outline-none",
        "focus:bg-accent focus:text-accent-foreground",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="absolute right-3 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>
        <span className="flex items-center gap-2">
          {model.icon && (
            <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">
              {model.icon}
            </span>
          )}
          <span className="truncate font-medium">{model.name}</span>
        </span>
      </SelectPrimitive.ItemText>
      {model.description && (
        <span className="truncate text-muted-foreground text-xs">
          {model.description}
        </span>
      )}
    </SelectPrimitive.Item>
  );
}

export type ModelSelectorProps = Omit<ModelSelectorRootProps, "children"> &
  VariantProps<typeof selectTriggerVariants> & {
    contentClassName?: string;
  };

const ModelSelectorImpl = ({
  value: controlledValue,
  onValueChange: controlledOnValueChange,
  defaultValue,
  models,
  variant,
  size,
  contentClassName,
  ...forwardedProps
}: ModelSelectorProps) => {
  const isControlled = controlledValue !== undefined;
  const [internalValue, setInternalValue] = useState(
    () => defaultValue ?? models[0]?.id ?? "",
  );

  const value = isControlled ? controlledValue : internalValue;
  const onValueChange = controlledOnValueChange ?? setInternalValue;

  // Cast to any to work around incomplete AssistantClient typings in
  // @assistant-ui/react. At runtime the client exposes a `modelContext`
  // helper, but it is not declared on the public TypeScript type yet.
  const api = useAssistantApi() as any;

  // On mount, hydrate the selector from localStorage (when available) so
  // that the chosen model does not jump back to the default after sending
  // the first message or when the composer re-mounts.
  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      const stored = window.localStorage.getItem(
        MODEL_SELECTOR_STORAGE_KEY,
      );
      if (!stored) return;

      const existsInModels = models.some((model) => model.id === stored);
      if (!existsInModels) return;

      // Only update internal state when the selector is uncontrolled. When
      // a parent component supplies `value`, it is the source of truth.
      if (!isControlled) {
        setInternalValue(stored);
      }
    } catch {
      // If localStorage is unavailable (e.g. in private mode) we simply
      // fall back to the in-memory default without failing.
    }
  }, [isControlled, models]);

  // Persist the current selection to localStorage so it is reused on
  // follow-up questions and across component re-mounts.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!value) return;

    try {
      window.localStorage.setItem(MODEL_SELECTOR_STORAGE_KEY, value);
    } catch {
      // Ignore persistence failures; they should not break the selector.
    }
  }, [value]);

  useEffect(() => {
    const config = { config: { modelName: value } };

    // Guard in case a future version of the library changes or removes
    // modelContext – in that case we simply skip registration.
    const modelCtx = api?.modelContext?.();
    if (!modelCtx?.register) return;

    return modelCtx.register({
      getModelContext: () => config,
    });
  }, [api, value]);

  return (
    <ModelSelectorRoot
      models={models}
      value={value}
      onValueChange={onValueChange}
      {...forwardedProps}
    >
      <ModelSelectorTrigger variant={variant} size={size} />
      <ModelSelectorContent className={contentClassName} />
    </ModelSelectorRoot>
  );
};

type ModelSelectorComponent = typeof ModelSelectorImpl & {
  displayName?: string;
  Root: typeof ModelSelectorRoot;
  Trigger: typeof ModelSelectorTrigger;
  Content: typeof ModelSelectorContent;
  Item: typeof ModelSelectorItem;
  Value: typeof ModelSelectorValue;
};

const ModelSelector = memo(
  ModelSelectorImpl,
) as unknown as ModelSelectorComponent;

ModelSelector.displayName = "ModelSelector";
ModelSelector.Root = ModelSelectorRoot;
ModelSelector.Trigger = ModelSelectorTrigger;
ModelSelector.Content = ModelSelectorContent;
ModelSelector.Item = ModelSelectorItem;
ModelSelector.Value = ModelSelectorValue;

export {
  ModelSelector,
  ModelSelectorRoot,
  ModelSelectorTrigger,
  ModelSelectorContent,
  ModelSelectorItem,
  ModelSelectorValue,
};
