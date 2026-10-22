# Module 00 — Mjolnir Foundations: notes for review

**Status:** draft for review (Phase B). Not linked from HoloBase and not open to students.
**Prepared for:** Bent Petersen, as author of the Mjolnir Knowledge Base, before release.

## What this module is (and isn't)

- A shared HoloBase course, completed once by every student, whatever project they join.
- It teaches HPC concepts and lets students practise in a **browser-only simulation**. The simulator has a
  fictional user (`sim123`), project (`hb_training`) and compute nodes (`simnode01`–`04`). It never
  connects to Mjolnir: the page's security policy blocks all network connections from its scripts, and
  the simulator runs no real commands.
- It does **not** reproduce *First 15 minutes on Mjolnir*. Students are sent there for their real
  first session, after their account is approved through *Request access*.
- Every exercise links the Knowledge Base page it is based on, and the page says the Knowledge Base
  wins if anything disagrees.

## Mjolnir-specific statements and their source (checked 2026-10-22)

| Statement in the module / simulator | Knowledge Base page |
|---|---|
| Login node `mjolnirgate`; connect with `ssh <KU-ID>@mjolnirgate.unicph.domain` over the UCPH VPN | First 15 minutes; VPN and SSH access |
| "Running computation on the login node is not permitted, and persistent misuse can lead to access being withdrawn." | Login nodes vs compute nodes |
| `--qos` is mandatory; jobs without a QoS are rejected | Partitions, QoS, and fairshare; Submitting jobs |
| Partitions `cpuqueue` (default), `gpuqueue`, `lazyqueue`, plus `filetransfer` and `teaching` (restricted); defaults 1 hour and 2 GB per CPU; QoS `normal` max 48 CPUs; `lazyqueue` with `--qos=lazy` | Partitions, QoS, and fairshare |
| "Your usage is charged on what you request, not what you use."; small, realistic requests backfill more easily | Partitions, QoS, and fairshare |
| Reply "Submitted batch job <jobid>"; `squeue -u $USER`, states PD / R / CG; `squeue -u $USER -o "%.10i %.8T %R"` | First 15 minutes; Monitoring jobs |
| `sacct -j`, `scontrol show job`, `scancel`, `seff` (layout of the illustrative example) | Monitoring jobs; Check job efficiency; Cancelling jobs |
| `srun --partition=cpuqueue --qos=normal --nodes=1 --cpus-per-task=2 --mem-per-cpu=2G --time=01:00:00 --pty bash`; idle sessions still hold resources | Interactive jobs |
| Environment Modules 4.5.2, not Lmod; `module spider` doesn't exist; `module avail/load/list/unload/switch/purge/display/whatis/apropos`; `samtools/1.21` | Find and load software |
| `/home/<KU-ID>` limited to 100 GB, "not the place for datasets or job output"; `/projects/<project>/people/<KU-ID>/`, `data/`, `apps/`, `scratch/` (not backed up) | Where should my files go? |
| Don't create a missing project or people folder — ask through Getting help | First 15 minutes |
| `du -sh --apparent-size` for reporting; `du -h --apparent-size --max-depth=1 … \| sort -h` | How much storage am I using? |
| "The absence of an enforced project quota is not an invitation to store without limit." | Storage limits and responsibilities |
| Support Center, and what to include in a request; new accounts and VPN problems go elsewhere | Getting help |
| Accounts: User application form, confirmed by the PI | Request access |

## Deliberate simplifications (please check these are acceptable)

- **Time runs faster** in the simulation (about five times faster while a job runs), and jobs pend for a few
  seconds before starting.
- **Error and status messages** are the simulator's own explanations, labelled "Simulation:". Where the
  Knowledge Base gives no exact text (for example the rejection for a missing QoS), none is invented.
- **Default output file** `slurm-<jobid>.out` when `--output` is omitted is general Slurm behaviour;
  the Knowledge Base doesn't state it.
- **Module catalogue:** only `samtools/1.21` comes from the Knowledge Base. Other names and versions
  (`samtools/1.17`, `fastqc`, `multiqc`, `bwa`, `python`) are examples, and the page says so.
- **Pending reasons** `(Priority)` and `(Resources)`, `sacct` values, `seff` figures and file sizes are
  illustrative.
- **Compute node names** are fictional, because the Knowledge Base doesn't name compute nodes.
- **Not simulated:** `zcat`/`gzip`, `salloc` (pointed to `srun --pty bash`), `sinfo`, GPUs,
  `tail -f` (shows the file once), `less` (prints the whole file), `vim` (opens the simple editor).
- **Safety stops:** `rm` on the home, people or shared folders is stopped with an explanation. Real
  computation on the login node is stopped with the Knowledge Base rule.

## Questions for Bent

1. Are any of the statements above out of date, or worded in a way you'd change?
2. Should the course mention anything else every new user needs before their first session — for
   example SSH keys, or the `/datasets/globe_databases` repository?
3. Is it acceptable to show the real login node name `mjolnirgate` in the practice prompt, clearly
   labelled SIMULATION?
4. Would you like the readiness check questions (next phase) to be reviewed by you too?
