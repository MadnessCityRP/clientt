import * as React from "react";
import { useListener } from "@casper124578/use-socket.io";
import { SocketEvents } from "@snailycad/config";
import { Button } from "components/Button";
import { Manage911CallModal } from "components/modals/Manage911CallModal";
import { useAuth } from "context/AuthContext";
import format from "date-fns/format";
import { useRouter } from "next/router";
import { Full911Call, useDispatchState } from "state/dispatchState";
import { ActiveOfficer } from "state/leoState";
import { Call911, Officer } from "types/prisma";
import { useTranslations } from "use-intl";
import { useModal } from "context/ModalContext";
import { ModalIds } from "types/ModalIds";

export const ActiveCalls = () => {
  const { calls, setCalls } = useDispatchState();
  const t = useTranslations("Calls");
  const common = useTranslations("Common");
  const { user } = useAuth();
  const router = useRouter();
  const isDispatch = router.pathname === "/dispatch" && user?.isDispatch;
  const { openModal } = useModal();

  const [tempCall, setTempCall] = React.useState<Full911Call | null>(null);

  const makeUnit = (officer: Officer) =>
    `${officer.callsign} ${officer.name} ${
      "department" in officer ? `(${(officer as ActiveOfficer).department.value})` : ""
    }`;

  useListener(
    SocketEvents.Create911Call,
    (data) => {
      setCalls([data, ...calls]);
    },
    [calls, setCalls],
  );

  useListener(
    SocketEvents.End911Call,
    (data: Call911) => {
      setCalls(calls.filter((v) => v.id !== data.id));
    },
    [calls, setCalls],
  );

  useListener(
    SocketEvents.Update911Call,
    (call) => {
      setCalls(
        calls.map((v) => {
          if (v.id === call.id) {
            return call;
          }

          return v;
        }),
      );
    },
    [calls, setCalls],
  );

  function handleManageClick(call: Full911Call) {
    setTempCall(call);
    openModal(ModalIds.Manage911Call);
  }

  return (
    <div className="bg-gray-200/80 rounded-md overflow-hidden">
      <header className="bg-gray-300/50 px-4 p-2">
        <h3 className="text-xl font-semibold">{t("active911Calls")}</h3>
      </header>

      <div className="px-4">
        {calls.length <= 0 ? (
          <p className="py-2">{t("no911Calls")}</p>
        ) : (
          <div className="overflow-x-auto w-full  max-h-80 mt-3">
            <table className="overflow-hidden w-full whitespace-nowrap">
              <thead className="sticky top-0">
                <tr>
                  <th className="bg-gray-300">{t("caller")}</th>
                  <th className="bg-gray-300">{t("location")}</th>
                  <th className="bg-gray-300">{common("description")}</th>
                  <th className="bg-gray-300">{common("createdAt")}</th>
                  <th className="bg-gray-300">{t("assignedUnits")}</th>
                  {isDispatch ? <th className="bg-gray-300">{common("actions")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {calls.map((call) => (
                  <tr key={call.id}>
                    <td>{call.name}</td>
                    <td>{call.location}</td>
                    <td>{call.description}</td>
                    <td>{format(new Date(call.createdAt), "HH:mm:ss - yyyy-MM-dd")}</td>
                    <td>{call.assignedUnits.map(makeUnit).join(", ") || common("none")}</td>
                    {isDispatch ? (
                      <td>
                        <Button small variant="success" onClick={() => handleManageClick(call)}>
                          {common("manage")}
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Manage911CallModal onClose={() => setTempCall(null)} call={tempCall} />
    </div>
  );
};