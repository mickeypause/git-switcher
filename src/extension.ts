import * as vscode from "vscode";
import { exec } from "child_process";
import { User } from "./types";

const getUsersList = (): User[] => {
  const users = vscode.workspace
    .getConfiguration("git-switcher")
    .get("users", []);
  return users;
};

const getCurrentUser = async (): Promise<User> => {
  let currentUser: User = {
    name: "",
    email: "",
  };
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    let repoPath = "";
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showWarningMessage("No workspace folder found, trying to get global user");
    } else {
      repoPath = workspaceFolders[0].uri.fsPath;
    }

    const result = await new Promise<string>((resolve, reject) => {
      exec("git config user.name && git config user.email", { cwd: repoPath || undefined }, (err, stdout) => {
      if (err) {
        reject(err);
      } else {
        resolve(stdout.trim());
      }
      });
    });

    const [name, email] = result.split("\n");
    currentUser.name = name;
    currentUser.email = email;
  } catch (err) {
    vscode.window.showErrorMessage("Error getting current user");
  }
  const usersList = getUsersList();
  const user = usersList.find(
    (u: User) => u.name === currentUser.name && u.email === currentUser.email,
  );
  if (!user) {
    usersList.push(currentUser);
    await vscode.workspace
      .getConfiguration("git-switcher")
      .update("users", usersList, vscode.ConfigurationTarget.Global);
  }
  return currentUser;
};

const setUser = async (user: User, global: boolean = false) => {
  try {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage("No workspace folder found");
      return;
    }

    const repoPath = workspaceFolders[0].uri.fsPath;

    const isRepoInitialized = await new Promise<boolean>((resolve, reject) => {
      exec("git rev-parse --is-inside-work-tree", { cwd: repoPath }, (err) => {
        if (err) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });

    if (!isRepoInitialized && !global) {
      vscode.window.showErrorMessage(
        "Git repository not initialized. Please initialize a repository or set the user globally.",
      );
      return;
    }

    const configScope = global ? "--global" : "";
    await new Promise<void>((resolve, reject) => {
      exec(
        `git config ${configScope} user.name "${user.name}" && git config ${configScope} user.email "${user.email}"`,
        { cwd: repoPath },
        (err) => {
          if (err) {
            console.error("Error setting user:", err);
            reject(err);
          } else {
            resolve();
          }
        },
      );
    });
    const usersList = getUsersList();
    const userExists = usersList.find(
      (u: User) => u.name === user.name && u.email === user.email,
    );
    if (!userExists) {
      usersList.push(user);
      await vscode.workspace
        .getConfiguration("git-switcher")
        .update("users", usersList, vscode.ConfigurationTarget.Global);
    }
    return user;
  } catch (err) {
    vscode.window.showErrorMessage("Error setting current user");
  }
};

export function activate(context: vscode.ExtensionContext) {
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );

  const users = getUsersList();

  if (users.length === 0) {
    vscode.commands.executeCommand("git-switcher.setupUser");
  }

  getCurrentUser()
    .then((user) => {
      statusBarItem.text = user.name || "Git Switcher - No User Set";
      statusBarItem.tooltip = "Click to setup git user";
      statusBarItem.command = "git-switcher.setupUser";
      statusBarItem.show();
    })
    .catch(() => {
      statusBarItem.text = "Git Switcher - Setup Required";
      statusBarItem.tooltip = "Click to setup git user";
      statusBarItem.command = "git-switcher.setupUser";
      statusBarItem.show();
    });

  const setupUser = vscode.commands.registerCommand(
    "git-switcher.setupUser",
    async () => {
      const users = getUsersList();
      const items: vscode.QuickPickItem[] = [
        {
          label: "$(plus) Add new user",
          alwaysShow: true,
        },
        ...users.map((user: User) => ({
          label: user.name,
          description: user.email,
        })),
      ];

      const selectedUser = await vscode.window.showQuickPick(items, {
        placeHolder: "Select a user to switch to or add a new user",
      });

      if (selectedUser) {
        if (selectedUser.label === "$(plus) Add new user") {
          const name = await vscode.window.showInputBox({
            prompt: "Enter user name",
          });
          const email = await vscode.window.showInputBox({
            prompt: "Enter user email",
          });

          if (name && email) {
            const newUser: User = { name, email };
            const scopeItems: vscode.QuickPickItem[] = [
              {
                label: "Local",
                description: "Set user for the current repository",
              },
              { label: "Global", description: "Set user globally" },
            ];

            const selectedScope = await vscode.window.showQuickPick(
              scopeItems,
              {
                placeHolder: "Set user locally or globally?",
              },
            );

            if (selectedScope) {
              const global = selectedScope.label === "Global";
              const result = await setUser(newUser, global);
              if (result) {
                statusBarItem.text = result.name;
                vscode.window.showInformationMessage(
                  `${newUser.name} added and set ${global ? "globally" : "locally"}`,
                );
              }
            }
          } else {
            vscode.window.showErrorMessage(
              "All fields are required to add a new user",
            );
          }
        } else {
          let user: User = {
            name: selectedUser.label,
            email: selectedUser.description || "",
          };

          const scopeItems: vscode.QuickPickItem[] = [
            {
              label: "Local",
              description: "Set user for the current repository",
            },
            { label: "Global", description: "Set user globally" },
          ];

          const selectedScope = await vscode.window.showQuickPick(scopeItems, {
            placeHolder: "Set user locally or globally?",
          });

          if (selectedScope) {
            const global = selectedScope.label === "Global";
            const result = await setUser(user, global);
            if (result) {
              statusBarItem.text = result.name;
              vscode.window.showInformationMessage(
                `${selectedUser.label} selected and set ${global ? "globally" : "locally"}`,
              );
            }
          }
        }
      }
    },
  );

  context.subscriptions.push(setupUser);
}

export function deactivate() {}
