import { Res, Controller, UseBeforeEach, Use, Req } from "@tsed/common";
import { Delete, Get, JsonRequestBody, Post, Put } from "@tsed/schema";
import { CREATE_OFFICER_SCHEMA, UPDATE_OFFICER_STATUS_SCHEMA, validate } from "@snailycad/schemas";
import { BodyParams, Context, PathParams } from "@tsed/platform-params";
import { BadRequest, NotFound } from "@tsed/exceptions";
import { prisma } from "../../lib/prisma";
import { cad, ShouldDoType, StatusEnum, MiscCadSettings, User } from ".prisma/client";
import { setCookie } from "../../utils/setCookie";
import { Cookie } from "@snailycad/config";
import { IsAuth } from "../../middlewares";
import { signJWT } from "../../utils/jwt";
import { Socket } from "../../services/SocketService";
import { getWebhookData, sendDiscordWebhook } from "../../lib/discord";
import { APIWebhook } from "discord-api-types/payloads/v9/webhook";
import { ActiveDeputy } from "../../middlewares/ActiveDeputy";

// todo: check for EMS-FD permissions
@Controller("/ems-fd")
@UseBeforeEach(IsAuth)
export class EmsFdController {
  private socket: Socket;
  constructor(socket: Socket) {
    this.socket = socket;
  }

  @Get("/")
  async getUserDeputies(@Context("user") user: User) {
    const deputies = await prisma.emsFdDeputy.findMany({
      where: {
        userId: user.id,
      },
      include: {
        department: true,
        division: {
          include: {
            value: true,
          },
        },
      },
    });

    return deputies;
  }

  @Post("/")
  async createEmsFdDeputy(@BodyParams() body: JsonRequestBody, @Context("user") user: User) {
    const error = validate(CREATE_OFFICER_SCHEMA, body.toJSON(), true);
    if (error) {
      throw new BadRequest(error);
    }

    const deputy = await prisma.emsFdDeputy.create({
      data: {
        name: body.get("name"),
        callsign: body.get("callsign"),
        userId: user.id,
        departmentId: body.get("department"),
        divisionId: body.get("division"),
        badgeNumber: parseInt(body.get("badgeNumber")),
      },
      include: {
        department: true,
        division: {
          include: {
            value: true,
          },
        },
      },
    });

    return deputy;
  }

  @Put("/:id")
  async updateDeputy(
    @PathParams("id") deputyId: string,
    @BodyParams() body: JsonRequestBody,
    @Context("user") user: User,
  ) {
    const error = validate(CREATE_OFFICER_SCHEMA, body.toJSON(), true);
    if (error) {
      throw new BadRequest(error);
    }

    const deputy = await prisma.emsFdDeputy.findFirst({
      where: {
        id: deputyId,
        userId: user.id,
      },
    });

    if (!deputy) {
      throw new NotFound("deputyNotFound");
    }

    const updated = await prisma.emsFdDeputy.update({
      where: {
        id: deputy.id,
      },
      data: {
        name: body.get("name"),
        callsign: body.get("callsign"),
        departmentId: body.get("department"),
        divisionId: body.get("division"),
        badgeNumber: parseInt(body.get("badgeNumber")),
      },
      include: {
        department: true,
        division: {
          include: {
            value: true,
          },
        },
      },
    });

    return updated;
  }

  @Put("/:id/status")
  async setDeputyStatus(
    @PathParams("id") deputyId: string,
    @BodyParams() body: JsonRequestBody,
    @Context("user") user: User,
    @Context("cad") cad: cad & { miscCadSettings: MiscCadSettings },
    @Res() res: Res,
    @Req() req: Req,
  ) {
    const error = validate(UPDATE_OFFICER_STATUS_SCHEMA, body.toJSON(), true);

    if (error) {
      throw new BadRequest(error);
    }

    const isFromDispatch = req.headers["is-from-dispatch"]?.toString() === "true";
    const isDispatch = isFromDispatch && user.isDispatch;

    const deputy = await prisma.emsFdDeputy.findFirst({
      where: {
        userId: isDispatch ? undefined : user.id,
        id: deputyId,
      },
    });

    if (!deputy) {
      throw new NotFound("deputyNotFound");
    }

    if (deputy.suspended) {
      throw new BadRequest("deputySuspended");
    }

    const code = await prisma.statusValue.findFirst({
      where: {
        value: {
          value: body.get("status2"),
        },
      },
      include: {
        value: true,
      },
    });

    if (!code) {
      throw new NotFound("statusNotFound");
    }

    // reset all user
    await prisma.emsFdDeputy.updateMany({
      where: {
        userId: user.id,
      },
      data: {
        status: "OFF_DUTY",
        status2Id: null,
      },
    });

    let status: StatusEnum = StatusEnum.ON_DUTY;

    if (code.shouldDo === ShouldDoType.SET_STATUS && body.get("status") === StatusEnum.OFF_DUTY) {
      status = StatusEnum.OFF_DUTY;
    } else if (
      code.shouldDo === ShouldDoType.SET_OFF_DUTY &&
      body.get("status") === StatusEnum.ON_DUTY
    ) {
      status = StatusEnum.OFF_DUTY;
    } else if (
      code.shouldDo === ShouldDoType.SET_OFF_DUTY &&
      body.get("status") === StatusEnum.OFF_DUTY
    ) {
      status = StatusEnum.OFF_DUTY;
    } else {
      status = StatusEnum.ON_DUTY;
    }

    const updatedDeputy = await prisma.emsFdDeputy.update({
      where: {
        id: deputy.id,
      },
      data: {
        status,
        status2Id: status === StatusEnum.OFF_DUTY ? null : code.id,
      },
      include: {
        department: true,
        status2: {
          include: { value: true },
        },
      },
    });

    if (code.shouldDo === ShouldDoType.SET_OFF_DUTY) {
      setCookie({
        res,
        name: Cookie.ActiveDeputy,
        value: "",
        expires: -1,
      });
    } else {
      // expires after 3 hours.
      setCookie({
        res,
        name: Cookie.ActiveDeputy,
        value: signJWT({ deputyId: updatedDeputy.id }, 60 * 60 * 3),
        expires: 60 * 60 * 1000 * 3,
      });
    }

    if (cad.discordWebhookURL) {
      const webhook = await getWebhookData(cad.discordWebhookURL);
      if (!webhook) return;
      const data = createWebhookData(webhook, updatedDeputy);

      await sendDiscordWebhook(webhook, data);
    }

    this.socket.emitUpdateOfficerStatus();

    return updatedDeputy;
  }

  @Delete("/:id")
  async deleteDeputy(@PathParams("id") id: string, @Context() ctx: Context) {
    const deputy = await prisma.emsFdDeputy.findFirst({
      where: {
        userId: ctx.get("user").id,
        id,
      },
    });

    if (!deputy) {
      throw new NotFound("deputyNotFound");
    }

    await prisma.emsFdDeputy.delete({
      where: {
        id: deputy.id,
      },
    });

    return true;
  }

  @Use(ActiveDeputy)
  @Get("/active-deputy")
  async getActiveDeputy(@Context() ctx: Context) {
    return ctx.get("activeDeputy");
  }

  @Use(ActiveDeputy)
  @Get("/active-deputies")
  async getActiveDeputies() {
    const deputies = await prisma.emsFdDeputy.findMany({
      where: {
        status: StatusEnum.ON_DUTY,
      },
      include: {
        department: true,
        rank: true,
        division: {
          include: {
            value: true,
          },
        },
        status2: {
          include: {
            value: true,
          },
        },
      },
    });

    return deputies;
  }
}

export function createWebhookData(webhook: APIWebhook, officer: any) {
  console.log({ officer });

  const status2 = officer.status2.value.value;
  const department = officer.department.value;
  const officerName = `${officer.badgeNumber} - ${officer.name} ${officer.callsign} (${department})`;

  return {
    avatar_url: webhook.avatar,
    embeds: [
      {
        title: "Status Change",
        type: "rich",
        description: `Officer **${officerName}** has changed their status to ${status2}`,
        fields: [
          {
            name: "ON/OFF duty",
            value: officer.status,
            inline: true,
          },
          {
            name: "Status",
            value: status2,
            inline: true,
          },
        ],
      },
    ],
  };
}