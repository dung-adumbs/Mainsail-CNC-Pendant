# Fusion CNC Outbox add-in — first integration preview

Adds **Post to CNC Outbox** in a dedicated Manufacture toolbar panel. Does not replace Autodesk's built-in Post Process command. The add-in's Python is syntax-checked and filename generation is unit tested. It still requires interactive testing in Fusion on the reference machine; do not describe this as a validated turnkey installer.

## Machine identification and first-use walkthrough

1. Manufacture > Manage > Machine Library. Locate an existing appropriate three-axis Cartesian milling machine in Local, or create a local definition from an appropriate generic three-axis machine. Do not select a five-axis or additive machine to obtain a name.
2. Name the machine model **LowRider V4** and description **Mainsail CNC Pendant**. Configure physical machine properties correctly; the add-in does not construct or validate machine kinematics. Associate the local Mainsail CNC Pendant post in the machine's Post Processing settings where available.
3. Edit each intended setup > Machine > Select. Choose this local machine, save the setup and Fusion document. Assign it to the Fasten Only setup as well as the main machining setup. Library definitions copied into documents are separate instances; changes in the library may not propagate into existing setups.
4. Utilities > Add-Ins > Scripts and Add-Ins > Add-Ins. Find **CncOutbox**, select it and Run. Enable Run on Startup. If not discovered, add its installation directory manually or restart Fusion after saving work.
5. Select one tool's operations and relevant Manual NC entries, a one-tool setup, or a saved one-tool NC Program, then press **Post to CNC Outbox** in Manufacture. A whole multi-tool setup is rejected. Suppressed operations are excluded. Selection order and completeness must be reviewed.
6. On first use, inspect the reported vendor/model/description and approve the intended machine. That invocation registers its identity only; press the command again to post. Changes to registered machine identity require reviewing local config; mismatches block posting.
7. Review the exact operation list, tool, machine and output filename. Yes posts; No cancels. Unique filenames include document, setup, tool description, full date/time with microseconds and a random suffix. No filename expression is needed for this command.
8. Inspect the first G-code header for `CNC_MACHINE_VENDOR`, `CNC_MACHINE_MODEL`, `CNC_MACHINE_DESCRIPTION`, `CNC_FUSION_SETUP` and expected stock values. Inspect the resulting program before running. Posting itself never starts the CNC.

## Installation details

Copy **CncOutbox/** into the user's Fusion API AddIns directory. Create `config.json` alongside its manifest, with `outbox` (absolute PC output path) and `post_description` (exact local post description). It deliberately contains no machine identity until the user registers an assigned machine. The post library must contain exactly one matching local post with vendor `Mainsail CNC Pendant`. Post v0.12 adds machine metadata; missing identity is marked Not assigned.

The command uses Fusion NC Programs to post. New NC Programs are retained in the document as an audit trail. It starts from the selected operations rather than modifying prior saved NC Programs. Post properties use the local post defaults for a new NC Program; optional travel optimization remains a separate pendant step. The command is not an automatic multi-tool splitter or bundle builder.

Stop the add-in in Scripts and Add-Ins and disable Run on Startup to restore the ordinary workflow. No built-in Fusion command, machine definition or existing NC Program is removed. Outbox transfers are controlled by the separate Windows helper.
