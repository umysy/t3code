# Fork

The language for maintaining `umysy/t3code`, a personal fork that carries its own changes on top of official T3 Code releases. This file is fork-only: official files never define these terms.

## Language

### What the fork carries

**Fork feature** (你的功能):
A change the fork owner wants to keep in every build of the fork for as long as the official release does not cover it.
_Avoid_: patch, customization, plugin

**Dev tooling** (开发工具):
A change that only protects or eases development of the fork and never reaches the installed app; it may be dropped whenever it conflicts and is hard to repair.
_Avoid_: infrastructure, fork feature

**Fork hook** (挂钩):
The smallest edit to an official file that connects a fork feature living in fork-owned files.
_Avoid_: patch point, integration, plugin entry

**Superseded change**:
A former fork feature or dev tooling item that the official release now covers, so the fork removes it instead of carrying it.
_Avoid_: obsolete patch

### Where the fork comes from

**Official release** (正式版):
A stable, non-preview, non-nightly version tag published by the official T3 Code project, such as `v0.1.11`.
_Avoid_: update, nightly, upstream main

**Fork build**:
An official release plus every fork feature, packaged for the fork owner's devices.
_Avoid_: custom build, our version

**Fork release** (fork 发布):
A fork build published on the fork's own GitHub releases, from which the fork owner's desktop and Android apps update themselves.
_Avoid_: official release, deploy

**Fork update**:
Moving the fork from one official release to the next and producing a new fork build.
_Avoid_: sync, upgrade, merge

### Where the fork runs

**Development environment** (开发环境):
A T3 home used only to change the fork's code, never to verify it.

**Test environment** (测试环境):
A T3 home used only to build and verify a fork build, never to change code.

**Live environment**:
The fork owner's real T3 Code data, which neither the development nor the test environment may use.
_Avoid_: production database, userdata
