// SPDX-License-Identifier: AGPL-3.0-only
interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="border-border flex h-14 shrink-0 items-center justify-between gap-4 border-b px-6">
      <div className="min-w-0">
        <h1 className="truncate text-sm font-medium">{title}</h1>
        {description && <p className="text-muted truncate text-xs">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
