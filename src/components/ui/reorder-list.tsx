"use client";

import { Fragment, useRef, type KeyboardEvent, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

export function ReorderList<T extends { id: string }>({
  items,
  enabled,
  onReorder,
  renderItem,
  isItemDisabled,
  getDragLabel,
}: {
  items: T[];
  enabled: boolean;
  onReorder: (items: T[]) => void;
  renderItem: (item: T) => ReactNode;
  isItemDisabled?: (item: T) => boolean;
  getDragLabel?: (item: T) => string;
}) {
  const keyboardTarget = useRef<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, scrollBehavior: "auto" }),
  );

  function dragEnd(event: DragEndEvent) {
    const { active, over } = event;
    // At a scroll edge the keyboard sensor scrolls before collision state updates.
    // Preserve the user's arrow destination when they drop immediately afterward.
    const target = keyboardTarget.current ?? over?.id;
    keyboardTarget.current = null;
    if (!target || active.id === target) return;
    const oldIndex = items.findIndex((item) => item.id === active.id);
    const newIndex = items.findIndex((item) => item.id === target);
    if (oldIndex < 0 || newIndex < 0) return;
    if (isItemDisabled?.(items[oldIndex]) || isItemDisabled?.(items[newIndex])) return;
    onReorder(arrayMove(items, oldIndex, newIndex));
  }
  function keyboardMove(event: KeyboardEvent<HTMLDivElement>) {
    if (keyboardTarget.current === null || !["ArrowUp", "ArrowDown"].includes(event.code)) return;
    const step = event.code === "ArrowDown" ? 1 : -1;
    const current = items.findIndex(item => item.id === keyboardTarget.current);
    if (current < 0) return;
    for (let index = current + step; index >= 0 && index < items.length; index += step) {
      if (!isItemDisabled?.(items[index])) { keyboardTarget.current = items[index].id; return; }
    }
  }

  if (!enabled) {
    return <div className="space-y-2">{items.map((item) => <Fragment key={item.id}>{renderItem(item)}</Fragment>)}</div>;
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={event => { keyboardTarget.current = event.activatorEvent.type === "keydown" ? String(event.active.id) : null; }} onDragCancel={() => { keyboardTarget.current = null; }} onDragEnd={dragEnd}>
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-2" onKeyDownCapture={keyboardMove}>
          {items.map((item) => (
            <SortableRow key={item.id} id={item.id} disabled={isItemDisabled?.(item)} dragLabel={getDragLabel?.(item)}>
              {renderItem(item)}
            </SortableRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({
  id,
  children,
  disabled = false,
  dragLabel = "ドラッグして並べ替え",
}: {
  id: string;
  children: ReactNode;
  disabled?: boolean;
  dragLabel?: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  return (
    <div
      ref={setNodeRef}
      className="flex items-stretch gap-1"
      style={{
        transform: disabled ? undefined : CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.65 : 1,
        zIndex: isDragging ? 20 : undefined,
      }}
    >
      <button data-ui-drag-handle
        type="button"
        aria-label={dragLabel}
        disabled={disabled}
        className="flex w-10 shrink-0 touch-none items-center justify-center rounded-lg text-muted active:bg-separator/50"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={21} aria-hidden />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
