export function NotificationsPage() {
  return (
    <div className="flex flex-col gap-xl">
      <h1 className="text-title-page font-sans font-bold text-text-primary">
        Notifications
      </h1>
      <div className="rounded-md border border-border-subtle bg-surface-primary p-2xl">
        <p className="text-body text-text-muted">
          No new notifications.
        </p>
      </div>
    </div>
  );
}
