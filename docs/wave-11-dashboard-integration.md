# Dashboard Integration — Notification Bell

> **Wave 11 — In-app Notifications**

## Current State

The `StudentTopBar` component already includes a **Bell** navigation item that
serves as the notification entry point. This was placed during the initial
dashboard layout wave.

## Integration Points

The notification feature connects to the existing dashboard via:

1. **NotificationBell** (`frontend/src/features/notifications/components/NotificationBell.tsx`)
   - Renders the unread badge count
   - Opens the `NotificationInbox` popover on click
   - Uses `useNotificationInbox` hook for data

2. **NotificationInbox** (`frontend/src/features/notifications/components/NotificationInbox.tsx`)
   - Popover panel displayed when the Bell is clicked
   - Paginated list of notifications with mark-as-read / dismiss actions
   - Cursor-based pagination via React Query infinite query

3. **ToastStackRenderer** (overlay, positioned fixed top-right)
   - Rendered at the app layout level (outside the TopBar)
   - Fed by the `useNotificationSubscription` hook (AppSync real-time)
   - Automatically dismissed after 5 seconds

## Wiring the Bell

To wire the `NotificationBell` component into the existing `StudentTopBar`:

```tsx
// In StudentTopBar.tsx — replace the static Bell icon with:
import { NotificationBell } from '@/features/notifications/components/NotificationBell';

// In the nav items section:
<NotificationBell />
```

The `NotificationBell` component already handles:
- Fetching unread count via `useNotificationInbox`
- Displaying the badge with count
- Opening/closing the inbox popover
- Keyboard accessibility (Enter/Space to toggle)

## Toast Overlay Placement

The `ToastStackRenderer` should be rendered in the root layout (e.g., `App.tsx`
or the authenticated layout wrapper) so it appears regardless of which page the
user is on:

```tsx
// In the authenticated layout:
import { useNotificationToastStack, ToastStackRenderer } from '@/features/notifications/components/NotificationToast';
import { useNotificationSubscription } from '@/features/notifications/hooks/useNotificationSubscription';

function AuthenticatedLayout({ children }) {
  const stack = useNotificationToastStack();
  useNotificationSubscription({
    onNewNotification: stack.push,
  });

  return (
    <>
      {children}
      <ToastStackRenderer
        toasts={stack.toasts}
        overflowCount={stack.overflowCount}
        duration={stack.duration}
        onDismiss={stack.dismiss}
      />
    </>
  );
}
```

## No Additional Changes Required

The StudentTopBar Bell nav item already exists. The only integration work is:
1. Swapping the static Bell icon for the `NotificationBell` component
2. Adding `ToastStackRenderer` to the layout

Both are single-line changes in the dashboard layout files.
