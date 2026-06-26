---
inclusion: manual
---

# KiroGraph: Refactoring Workflow

Follow these steps to plan and execute safe refactoring.

## Steps

1. **Understand what you're changing**
   ```
   kirograph_node(symbol: "<target symbol>", includeCode: true)
   ```

2. **Check blast radius**
   ```
   kirograph_impact(symbol: "<target symbol>", depth: 3)
   ```

3. **Check for cycles that might complicate the refactor**
   ```
   kirograph_circular_deps()
   ```

4. **Find dead code to clean up**
   ```
   kirograph_dead_code(limit: 30)
   ```

5. **Verify after changes**
   Run `kirograph sync` then:
   ```
   kirograph_diff()
   ```

## Safety Checks
- Always check `kirograph_impact` before major refactors
- After changes, use `kirograph_diff` to verify only intended symbols changed
