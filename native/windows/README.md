# FutureClick Native Adapter: Windows

Platform-specific system integration adapter for Microsoft Windows.

## Eventual Responsibilities

This adapter will bridge Windows operating system events and accessibility surfaces into the platform-agnostic FutureClick action representation:

1. **Windows UI Automation (UIA) & Accessibility:**
   - Traverse automation element trees (`IUIAutomation`) to observe control states, identifiers, bounding rectangles, and invoke patterns.
   - Capture pre-action focus and invocation intent on sensitive buttons, ribbons, and dialogs.
2. **Win32 Input & Low-Level Hooks:**
   - Detect invocation intent targeted at critical actions.
   - Exclude password inputs (`UIA_IsPasswordPropertyId`) at trust boundaries using defensive platform filters.
   - Zero keylogging: arbitrary keystroke capture is strictly banned.
3. **File System & Shell Namespace Integration:**
   - Resolve targets within Windows Explorer, Shell namespace extensions, and PowerShell invocations.
   - Evaluate NTFS permissions, access control lists (ACLs), and cloud hydration status (e.g., OneDrive placeholders).
4. **IPC Bridge:**
   - Transmit normalized actions to the desktop daemon via Windows Named Pipes or local RPC.

## Implementation Restrictions (Sprint FC-001)

- In Sprint FC-001, Windows UI Automation and native Win32 hooks are **strictly NOT implemented**.
- This directory serves as an architectural boundary and documentation anchor. C++/C#/Rust native bindings will be introduced in subsequent platform-specific milestones.
