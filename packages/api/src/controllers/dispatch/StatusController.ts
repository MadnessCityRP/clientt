import { User, ShouldDoType, MiscCadSettings, cad } from ".prisma/client";
import { UPDATE_OFFICER_STATUS_SCHEMA, validate } from "@snailycad/schemas";
import { Req, Res, UseBeforeEach } from "@tsed/common";
import { Controller } from "@tsed/di";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { BodyParams, Context, PathParams } from "@tsed/platform-params";
import { JsonRequestBody, Put } from "@tsed/schema";
import { prisma } from "../../lib/prisma";
import { findUnit } from "./Calls911Controller";
import { unitProperties } from "../../lib/officer";
import { setCookie } from "../../utils/setCookie";
import { Cookie } from "@snailycad/config";
import { signJWT } from "../../utils/jwt";
import { getWebhookData, sendDiscordWebhook } from "../../lib/discord";
import { Socket } from "../../services/SocketService";
import { APIWebhook } from "discord-api-types";
import { IsAuth } from "../../middlewares";

@Controller("/dispatch/status")
@UseBeforeEach(IsAuth)
export class StatusController {
  private socket: Socket;
  constructor(socket: Socket) {
    this.socket = socket;
  }

  @Put("/:unitId")
  async updateUnitStatus(
    @PathParams("unitId") unitId: string,
    @Context("user") user: User,
    @BodyParams() body: JsonRequestBody,
    @Res() res: Res,
    @Req() req: Req,
    @Context("cad") cad: cad & { miscCadSettings: MiscCadSettings },
  ) {
    const error = validate(UPDATE_OFFICER_STATUS_SCHEMA, body.toJSON(), true);
    if (error) {
      throw new BadRequest(error);
    }

    const statusId = body.get("status");

    const isFromDispatch = req.headers["is-from-dispatch"]?.toString() === "true";
    const isDispatch = isFromDispatch && user.isDispatch;

    const { type, unit } = await findUnit(
      unitId,
      { userId: isDispatch ? undefined : user.id },
      true,
    );

    if (!unit) {
      throw new NotFound("unitNotFound");
    }

    if (unit.suspended) {
      throw new BadRequest("unitSuspended");
    }

    const code = await prisma.statusValue.findFirst({
      where: {
        id: statusId,
      },
      include: {
        value: true,
      },
    });

    if (!code) {
      throw new NotFound("statusNotFound");
    }

    // reset all units for user
    if (type === "leo") {
      await prisma.officer.updateMany({
        where: {
          userId: user.id,
        },
        data: {
          statusId: null,
        },
      });
    } else {
      await prisma.emsFdDeputy.updateMany({
        where: {
          userId: user.id,
        },
        data: {
          statusId: null,
        },
      });
    }

    let updatedUnit;
    if (type === "leo") {
      updatedUnit = await prisma.officer.update({
        where: {
          id: unit.id,
        },
        data: {
          statusId: code.shouldDo === ShouldDoType.SET_OFF_DUTY ? null : code.id,
        },
        include: unitProperties,
      });
    } else {
      updatedUnit = await prisma.emsFdDeputy.update({
        where: {
          id: unit.id,
        },
        data: {
          statusId: code.shouldDo === ShouldDoType.SET_OFF_DUTY ? null : code.id,
        },
        include: unitProperties,
      });
    }

    if (type === "leo") {
      const officerLog = await prisma.officerLog.findFirst({
        where: {
          officerId: unit.id,
          endedAt: null,
        },
      });

      if (code.shouldDo === ShouldDoType.SET_ON_DUTY) {
        if (!officerLog) {
          await prisma.officerLog.create({
            data: {
              officerId: unit.id,
              userId: user.id,
              startedAt: new Date(),
            },
          });
        }
      } else {
        if (code.shouldDo === ShouldDoType.SET_OFF_DUTY) {
          // unassign officer from call
          await prisma.assignedUnit.deleteMany({
            where: {
              officerId: unit.id,
            },
          });

          if (officerLog) {
            await prisma.officerLog.update({
              where: {
                id: officerLog.id,
              },
              data: {
                endedAt: new Date(),
              },
            });
          }
        }
      }
    } else {
      // unassign deputy from call
      await prisma.assignedUnit.deleteMany({
        where: {
          emsFdDeputyId: unit.id,
        },
      });
    }

    if (code.shouldDo === ShouldDoType.SET_OFF_DUTY) {
      setCookie({
        res,
        name: Cookie.ActiveOfficer,
        value: "",
        expires: -1,
      });
    } else {
      const cookieName = type === "leo" ? Cookie.ActiveOfficer : Cookie.ActiveOfficer;
      const cookiePayloadName = type === "leo" ? "officerId" : "deputyId";

      // expires after 3 hours.
      setCookie({
        res,
        name: cookieName,
        value: signJWT({ [cookiePayloadName]: updatedUnit.id }, 60 * 60 * 3),
        expires: 60 * 60 * 1000 * 3,
      });
    }

    if (cad.discordWebhookURL) {
      const webhook = await getWebhookData(cad.discordWebhookURL);
      if (!webhook) return;
      const data = createWebhookData(webhook, updatedUnit);

      await sendDiscordWebhook(webhook, data);
    }

    if (type === "leo") {
      this.socket.emitUpdateOfficerStatus();
    } else {
      this.socket.emitUpdateDeputyStatus();
    }

    return updatedUnit;
  }
}

function createWebhookData(webhook: APIWebhook, unit: any) {
  const status = unit.status.value.value;
  const department = unit.department.value.value;
  const officerName = `${unit.badgeNumber} - ${unit.name} ${unit.callsign} (${department})`;

  return {
    avatar_url: webhook.avatar,
    embeds: [
      {
        title: "Status Change",
        type: "rich",
        description: `Unit **${officerName}** has changed their status to ${status}`,
        fields: [
          {
            name: "Status",
            value: status,
            inline: true,
          },
        ],
      },
    ],
  };
}