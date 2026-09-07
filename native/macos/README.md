# FutureClick Native Adapter: macOS

Platform-specific system integration adapter for macOS.

## Eventual Responsibilities

This adapter will bridge macOS operating system events and accessibility surfaces into the platform-agnostic FutureClick action representation:

1. **Accessibility APIs (`AXUIElement` / `NSAccessibility`):**
   - Query focused UI hierarchies, control identifiers, and accessibility labels without modifying host applications.
   - Detect pre-execution user intent (e.g., hover over destructive controls, dialog confirmation buttons).
2. **Event Tap / Quartz Event Services:**
   - Detect user input gestures targeted at high-consequence UI controls with strict adherence to privacy restrictions.
   - Zero keylogging: password fields and arbitrary keystroke capture are strictly banned.
3. **File System and Sandbox Introspection:**
   - Resolve file targets for Finder operations, drag-and-drop operations, and Terminal commands.
   - Inspect macOS sandbox attributes and entitlements.
4. **IPC Bridge:**
   - Communicate observed `EnvironmentState` and `ProposedAction` candidates to the local FutureClick desktop daemon using high-performance Unix Domain Sockets or XPC.

## Implementation Restrictions (Sprint FC-001)

- In Sprint FC-001, Accessibility APIs and native OS hooks are **strictly NOT implemented**.
- This directory serves as an architectural boundary and documentation anchor. Native Objective-C/Swift/Rust scaffolding will be introduced in subsequent platform-specific milestones after core contracts are validated.
