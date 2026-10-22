"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

const TaskBoard = dynamic(
  () => import("@/components/task-board").then((module) => module.TaskBoard),
  {
    ssr: false,
    loading: () => (
      <div className="empty" style={{ marginTop: 40 }}>
        Opening your saved tasks…
      </div>
    ),
  },
);

export function TaskBoardLoader(props: ComponentProps<typeof TaskBoard>) {
  return <TaskBoard {...props} />;
}
